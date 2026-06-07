# Kubernetes 自动化部署设计

**日期**: 2026-06-07
**状态**: 已确认，待实现

## 目标

提供一份「一条命令」即可把 dev-efficiency（Next.js 服务端 + PostgreSQL）完整部署到 Kubernetes 集群的方案：构建并推送镜像 → Helm 安装/升级 → 自动迁移与 seed → 应用滚动上线 → 通过 nginx Ingress + cert-manager 暴露 HTTPS。

## 约束与决策

经与用户确认：

| 维度 | 决策 |
|------|------|
| 打包格式 | Helm chart |
| 数据库 | 可切换：集群内 StatefulSet **或** 外部托管库（`postgres.deploy` 开关） |
| 暴露方式 | nginx Ingress + TLS |
| TLS 证书 | cert-manager 自动签发（Let's Encrypt） |
| 镜像 | 构建后推送到镜像仓库（多节点集群可拉取） |
| 迁移/seed | Helm pre-install/pre-upgrade hook Job（多副本安全），需改 Dockerfile CMD |

非目标（YAGNI）：HPA 自动扩缩、多环境 CD 流水线、监控/日志栈、备份方案。这些可后续单独立项。

## 现状（被部署对象）

- 单个 Next.js 容器，现有 `Dockerfile` 的 `CMD` 为 `prisma migrate deploy && db:seed && pnpm start`。
- 运行所需环境变量：`DATABASE_URL`、`SESSION_SECRET`（≥32 字符）、`ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME`、可选 `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`/`GITHUB_REDIRECT_URI`、`NEXT_PUBLIC_GITHUB_ENABLED`。
- 监听 3000 端口。

## 架构

### 目录结构

```
deploy/
  deploy.sh                       # 构建 → 推送 → helm upgrade --install → 等待 rollout
  helm/dev-efficiency/
    Chart.yaml
    values.yaml                   # 全部配置，含注释
    values.prod.example.yaml      # 生产覆盖示例（不含真实密钥）
    templates/
      _helpers.tpl                # 命名、标签、镜像引用、SESSION_SECRET 复用等 helper
      serviceaccount.yaml
      configmap.yaml              # 非敏感 env（NEXT_PUBLIC_GITHUB_ENABLED、GITHUB_REDIRECT_URI）
      secret.yaml                 # 敏感 env（SESSION_SECRET、ADMIN_*、GITHUB_*、external 模式下的 DATABASE_URL）
      deployment.yaml             # 应用 Deployment，CMD 仅 `pnpm start`
      service.yaml                # ClusterIP，指向 3000
      ingress.yaml                # nginx + cert-manager 注解 + TLS
      migrate-job.yaml            # Helm hook Job：migrate deploy + db:seed
      clusterissuer.yaml          # 可选：cert-manager ClusterIssuer（gated）
      postgres-statefulset.yaml   # 仅 postgres.deploy=true
      postgres-service.yaml       # 仅 postgres.deploy=true
      postgres-secret.yaml        # 仅 postgres.deploy=true
      NOTES.txt                   # 安装后提示（访问地址、后续步骤）
```

### 组件说明

**1. Dockerfile 改动（对现有代码的唯一改动）**

把 `CMD` 从 `sh -c "pnpm prisma migrate deploy && pnpm db:seed && pnpm start"` 改为仅启动应用：

```dockerfile
CMD ["pnpm", "start"]
```

迁移与 seed 改由独立 Job 复用同一镜像、通过 `command` 覆盖执行。这样多副本启动时不会并发跑迁移。`docker-compose.yml` 依赖旧 CMD，需相应调整（compose 的 app 服务改为显式 `command` 串联 migrate+seed+start，保持本地行为不变）。

**2. 应用 Deployment**

- 镜像由 `image.repository:image.tag` 指定，`imagePullPolicy` 可配，支持 `imagePullSecrets`。
- 副本数 `replicaCount`（默认 2）。
- env 来自 ConfigMap（非敏感）+ Secret（敏感）通过 `envFrom` 注入。
- `DATABASE_URL` 的来源取决于数据库模式（见下）。
- readiness/liveness 探针：HTTP GET `/login`（无需鉴权、稳定返回 200 的页面）on 3000。
- 资源 requests/limits 可配，给出合理默认。
- 普通资源（main 阶段），因此在迁移 hook 成功后才滚动上线。

**3. 迁移 / seed Job（Helm hook）**

- 注解 `helm.sh/hook: pre-install,pre-upgrade`，`helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded`。
- 复用应用镜像，`command` 覆盖为 `sh -c "pnpm prisma migrate deploy && pnpm db:seed"`。
- env 同应用（envFrom Secret/ConfigMap），拿到 `DATABASE_URL`、`ADMIN_*`。
- `initContainer: wait-for-db`——用轻量镜像循环探测数据库可达（`pg_isready` 或 `nc -z host 5432`），就绪后主容器才跑迁移。这样即使在集群内 Postgres 刚拉起、尚未 ready 时也能安全等待。
- `backoffLimit` 适当（如 5），失败可重试。
- `helm.sh/hook-weight: "5"`。

**4. PostgreSQL（`postgres.deploy` 开关）**

- `postgres.deploy=true`（集群内）：
  - `StatefulSet`（`postgres:16`）+ `volumeClaimTemplates`（大小、storageClass 可配）。
  - PVC/数据带 `helm.sh/resource-policy: keep`，`helm uninstall` 不删数据。
  - headless/ClusterIP Service。
  - Secret 保存库用户名/密码/库名；密码可在 values 提供，否则首次安装生成并通过 helper 在升级时复用。
  - 这些资源同样以 pre-install/pre-upgrade hook 渲染，`hook-weight: "0"`（小于迁移 Job 的 `"5"`），从而在迁移 Job 之前创建；`hook-delete-policy: before-hook-creation`（不在成功后删除，持久存在）。
  - 应用与迁移 Job 的 `DATABASE_URL` 由 chart 依据 Service 名拼装。
- `postgres.deploy=false`（外部库）：
  - 不渲染任何 Postgres 资源。
  - 用户在 `database.external.url` 提供连接串，写入应用 Secret 作为 `DATABASE_URL`。
  - 迁移 Job 的 `wait-for-db` 直接探测外部 host。

> 说明：集群内 Postgres 以 hook 形式部署是为了解决「迁移 hook 早于 main 阶段资源」的顺序问题（pre-install hook 在 main 资源之前执行）。代价是 `helm uninstall` 不会自动清理 Postgres（数据安全优先）。生产环境推荐使用外部托管库，顺序问题不存在，迁移 hook 仅需连接等待。

**5. Ingress + TLS（cert-manager）**

- Ingress：`ingressClassName: nginx`，host 来自 `ingress.host`，后端指向应用 Service:3000。
- TLS：`tls.mode` 支持 `certManager`（默认）/ `existingSecret` / `disabled`。
  - `certManager`：Ingress 加 `cert-manager.io/cluster-issuer: <name>` 注解，`tls` 段引用待签发的 secret 名；cert-manager 自动签发并续期。
  - `existingSecret`：直接引用用户提供的 TLS secret。
  - `disabled`：仅 HTTP。
- `clusterissuer.yaml` 在 `tls.mode=certManager && certManager.createClusterIssuer=true` 时渲染一个 Let's Encrypt ClusterIssuer（用 `certManager.email`、ACME server 可配 staging/prod）；否则引用既有 issuer。

**6. Secret 管理**

- 所有敏感值来自 `values.*.yaml` 或 `--set`，仓库不提交真实密钥；`values.prod.example.yaml` 仅作占位示例。
- `SESSION_SECRET`：若 values 未提供，首次安装用 helper 生成随机 ≥32 字符值；升级时用 `lookup` 读取已存在的 Secret 以复用同一值（避免重置导致已登录会话失效）。

### values.yaml 主要字段

```yaml
image:
  repository: ""            # 必填，如 ghcr.io/org/dev-efficiency
  tag: ""                   # 由 deploy.sh 注入（默认 git short sha）
  pullPolicy: IfNotPresent
  pullSecrets: []

replicaCount: 2
resources: { requests: {...}, limits: {...} }

app:
  sessionSecret: ""         # 留空则自动生成/复用
  admin:
    email: ""
    password: ""
    name: "Admin"
  github:
    enabled: false
    clientId: ""
    clientSecret: ""
    redirectUri: ""

database:
  external:
    url: ""                 # postgres.deploy=false 时必填

postgres:
  deploy: true
  image: postgres:16
  user: devuser
  password: ""              # 留空则生成/复用
  db: dev_efficiency
  storage:
    size: 10Gi
    storageClass: ""

ingress:
  host: ""                  # 必填，如 dev-efficiency.example.com
  className: nginx

tls:
  mode: certManager         # certManager | existingSecret | disabled
  secretName: dev-efficiency-tls
  existingSecret: ""
  certManager:
    createClusterIssuer: true
    issuerName: dev-efficiency-letsencrypt
    email: ""
    acmeServer: https://acme-v02.api.letsencrypt.org/directory
```

### deploy.sh

通过 flag / 环境变量配置，步骤幂等：

- 入参：`--registry`、`--tag`（默认 `git rev-parse --short HEAD`）、`--namespace`、`--release`、`--values <file>`、`--skip-build`、`--dry-run`。
- 流程：
  1. `docker build -t <registry>/<repo>:<tag> .`
  2. `docker push <registry>/<repo>:<tag>`
  3. `helm upgrade --install <release> deploy/helm/dev-efficiency --namespace <ns> --create-namespace -f <values> --set image.repository=... --set image.tag=<tag> --wait`
  4. `kubectl rollout status deployment/<release> -n <ns>`
- 缺少必填项（registry、ingress host 等）时给出清晰报错。

## 部署流程（数据流）

```
./deploy.sh
  → docker build & push 镜像
  → helm upgrade --install
      → [pre-install/pre-upgrade hooks，按 weight]
          weight 0: 集群内 Postgres StatefulSet/Service/Secret（仅 deploy=true）
          weight 5: 迁移 Job（initContainer 等待 DB → migrate deploy → db:seed）
      → [main 阶段] 应用 Deployment / Service / Ingress / ClusterIssuer
  → 应用滚动上线，readiness 通过
  → cert-manager 为 Ingress host 签发 TLS
  → kubectl rollout status 确认完成
```

## 错误处理

- **迁移失败**：hook Job 失败会使 `helm upgrade` 失败并返回非零，应用不会上线到新版本；`backoffLimit` 提供有限重试；日志可经 `kubectl logs job/...` 查看。
- **DB 不可达**：`wait-for-db` initContainer 阻塞并重试，避免迁移在 DB 未就绪时报错。
- **TLS 未就绪**：cert-manager 签发期间 Ingress 可能短暂无证书；NOTES.txt 提示用 `kubectl get certificate` 观察。
- **镜像拉取失败**：`imagePullSecrets` 可配；deploy.sh 推送失败即中止。
- **SESSION_SECRET 复用**：升级时通过 `lookup` 复用，避免会话失效。

## 测试 / 验证策略

- `helm lint deploy/helm/dev-efficiency` 通过。
- `helm template` 在两种数据库模式、三种 TLS 模式下渲染无误（人工 review 关键资源）。
- 在本地集群（kind / minikube，配 ingress-nginx + cert-manager + staging issuer）端到端跑一次 `deploy.sh`，确认：迁移 Job 成功、admin 可登录、Ingress 可访问、升级时数据与会话保留。
- `deploy.sh --dry-run` 输出预期命令而不执行。

## 实现影响清单

- **改**：`Dockerfile`（CMD）、`docker-compose.yml`（app 服务 command 保持本地行为）。
- **加**：`deploy/` 目录全部内容。
- **不改**：应用业务代码、数据库 schema、现有测试。
