# Kubernetes 自动化部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一条命令 `deploy/deploy.sh` 把 dev-efficiency（Next.js + PostgreSQL）构建镜像、推送仓库并经 Helm 部署到 k8s，自动完成迁移/seed 并通过 nginx Ingress + cert-manager 暴露 HTTPS。

**Architecture:** 新增 `deploy/` 目录，内含一个 Helm chart 和一个 bash 包装脚本。所有基础设施资源（ServiceAccount、Secret、ConfigMap、可选的集群内 Postgres、迁移 Job）以 Helm `pre-install,pre-upgrade` hook 按权重顺序创建；应用 Deployment / Service / Ingress / ClusterIssuer 作为 main 阶段资源，在迁移 hook 成功后才上线。唯一的现有代码改动是把迁移/seed 移出容器 `CMD`。

**Tech Stack:** Helm 3、kubectl、Docker、ingress-nginx、cert-manager、PostgreSQL 16、bash。

---

## 前置说明（执行前必读）

- **测试方式**：本计划是基础设施（YAML/模板）工作，没有单元测试框架。每个任务的「验证」用 `helm lint` 与 `helm template`（离线渲染 + grep 断言）替代单元测试，端到端验证在最后一个任务用本地集群（kind/minikube）完成。
- **执行目录**：除特别说明，`helm` 命令在 `deploy/helm/dev-efficiency` 目录下运行；`docker`/`git` 在仓库根目录。
- **集群前置**（仅最终端到端任务需要，不影响前面的渲染验证）：集群已安装 `ingress-nginx` 与 `cert-manager`（含其 CRD）。

### 文件清单

| 文件 | 责任 |
|------|------|
| `Dockerfile`（改） | 容器 `CMD` 仅 `pnpm start` |
| `docker-compose.yml`（改） | app 服务显式 `command` 保持本地「迁移+seed+启动」行为 |
| `deploy/deploy.sh`（建） | 构建→推送→helm upgrade→等待 rollout |
| `deploy/helm/dev-efficiency/Chart.yaml`（建） | chart 元数据 |
| `deploy/helm/dev-efficiency/values.yaml`（建） | 全部可配置项 + 默认值 |
| `deploy/helm/dev-efficiency/values.prod.example.yaml`（建） | 生产覆盖示例（占位，无真实密钥） |
| `deploy/helm/dev-efficiency/.helmignore`（建） | 打包忽略 |
| `deploy/helm/dev-efficiency/templates/_helpers.tpl`（建） | 命名/标签/密码与连接串 helper |
| `deploy/helm/dev-efficiency/templates/serviceaccount.yaml`（建） | ServiceAccount（hook -20） |
| `deploy/helm/dev-efficiency/templates/secret.yaml`（建） | `*-env` Secret（hook -10） |
| `deploy/helm/dev-efficiency/templates/configmap.yaml`（建） | `*-config` ConfigMap（hook -10） |
| `deploy/helm/dev-efficiency/templates/postgres-secret.yaml`（建） | 库密码 Secret（hook -5，条件） |
| `deploy/helm/dev-efficiency/templates/postgres-service.yaml`（建） | 库 Service（hook -5，条件） |
| `deploy/helm/dev-efficiency/templates/postgres-statefulset.yaml`（建） | 库 StatefulSet（hook -5，条件） |
| `deploy/helm/dev-efficiency/templates/migrate-job.yaml`（建） | 迁移/seed Job（hook 0） |
| `deploy/helm/dev-efficiency/templates/deployment.yaml`（建） | 应用 Deployment（main） |
| `deploy/helm/dev-efficiency/templates/service.yaml`（建） | 应用 Service（main） |
| `deploy/helm/dev-efficiency/templates/ingress.yaml`（建） | Ingress（main，条件） |
| `deploy/helm/dev-efficiency/templates/clusterissuer.yaml`（建） | cert-manager ClusterIssuer（main，条件） |
| `deploy/helm/dev-efficiency/templates/NOTES.txt`（建） | 安装后提示 |

### Hook 权重与阶段总览

```
pre-install,pre-upgrade hooks（按 weight 升序）：
  -20  ServiceAccount
  -10  Secret(*-env), ConfigMap(*-config)
   -5  Postgres Secret/Service/StatefulSet（仅 postgres.deploy=true）
    0  Migrate Job（initContainer 等 DB 就绪 → migrate deploy → db:seed）
main 阶段：
       Deployment, Service, Ingress, ClusterIssuer
```
所有 hook 资源用 `helm.sh/hook-delete-policy: before-hook-creation`（持久存在、每次部署前重建），因此 main 阶段资源可安全引用它们。

---

## Task 1: 调整 Dockerfile 与 docker-compose（迁移移出 CMD）

**Files:**
- Modify: `Dockerfile`（最后一行 `CMD`）
- Modify: `docker-compose.yml`（`app` 服务新增 `command`）

- [ ] **Step 1: 修改 Dockerfile 的 CMD**

把文件末尾的：

```dockerfile
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm db:seed && pnpm start"]
```

改为：

```dockerfile
CMD ["pnpm", "start"]
```

- [ ] **Step 2: 给 docker-compose 的 app 服务补回本地启动行为**

在 `docker-compose.yml` 的 `app:` 服务块内（与 `build: .` 同级）新增 `command`，使本地 compose 行为不变：

```yaml
  app:
    restart: unless-stopped
    build: .
    command: ["sh", "-c", "pnpm prisma migrate deploy && pnpm db:seed && pnpm start"]
    depends_on:
      db:
        condition: service_healthy
```

（其余字段保持原样，不要删除已有的 `environment`/`ports`。）

- [ ] **Step 3: 验证 compose 配置可解析**

Run: `docker compose config >/dev/null && echo OK`
Expected: 打印 `OK`，无报错。

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "build(docker): move migrate+seed out of image CMD for k8s job"
```

---

## Task 2: Helm chart 骨架（Chart.yaml / values.yaml / .helmignore）

**Files:**
- Create: `deploy/helm/dev-efficiency/Chart.yaml`
- Create: `deploy/helm/dev-efficiency/values.yaml`
- Create: `deploy/helm/dev-efficiency/.helmignore`

- [ ] **Step 1: 创建 Chart.yaml**

`deploy/helm/dev-efficiency/Chart.yaml`：

```yaml
apiVersion: v2
name: dev-efficiency
description: AI coding-tool token usage tracker (Next.js + PostgreSQL)
type: application
version: 0.1.0
appVersion: "0.1.0"
```

- [ ] **Step 2: 创建 .helmignore**

`deploy/helm/dev-efficiency/.helmignore`：

```
.git
*.tmp
*.bak
.DS_Store
```

- [ ] **Step 3: 创建 values.yaml**

`deploy/helm/dev-efficiency/values.yaml`：

```yaml
# 命名覆盖（一般留空）
nameOverride: ""
fullnameOverride: ""

image:
  repository: ""            # 必填，如 ghcr.io/org/dev-efficiency（由 deploy.sh 注入）
  tag: ""                   # 由 deploy.sh 注入（默认 git short sha）
  pullPolicy: IfNotPresent
  pullSecrets: []           # 如 [{name: my-regcred}]

replicaCount: 2

serviceAccount:
  create: true
  name: ""

resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: "1"
    memory: 1Gi

service:
  port: 3000

# 应用敏感/业务配置
app:
  sessionSecret: ""         # 留空则首次安装生成、升级复用（≥32 字符）
  admin:
    email: ""
    password: ""
    name: "Admin"
  github:
    enabled: false
    clientId: ""
    clientSecret: ""
    redirectUri: ""

# 数据库：postgres.deploy=false 时用外部库
database:
  external:
    url: ""                 # 如 postgresql://user:pass@host:5432/db?schema=public

# 集群内 PostgreSQL（postgres.deploy=true 时启用）
postgres:
  deploy: true
  image: postgres:16
  user: devuser
  password: ""              # 留空则生成/复用
  db: dev_efficiency
  storage:
    size: 10Gi
    storageClass: ""        # 留空用集群默认 StorageClass

ingress:
  host: ""                  # 必填，如 dev-efficiency.example.com
  className: nginx

tls:
  mode: certManager         # certManager | existingSecret | disabled
  secretName: dev-efficiency-tls
  existingSecret: ""        # mode=existingSecret 时填
  certManager:
    createClusterIssuer: true
    issuerName: dev-efficiency-letsencrypt
    email: ""               # createClusterIssuer=true 时必填
    acmeServer: https://acme-v02.api.letsencrypt.org/directory
```

- [ ] **Step 4: 验证 chart 可被识别**

Run（在 `deploy/helm/dev-efficiency`）: `helm lint .`
Expected: 输出含 `1 chart(s) linted, 0 chart(s) failed`（此时模板目录为空，lint 应通过；若提示 icon 推荐可忽略）。

- [ ] **Step 5: Commit**

```bash
git add deploy/helm/dev-efficiency/Chart.yaml deploy/helm/dev-efficiency/values.yaml deploy/helm/dev-efficiency/.helmignore
git commit -m "feat(helm): scaffold chart with values"
```

---

## Task 3: 模板 helper（_helpers.tpl）

**Files:**
- Create: `deploy/helm/dev-efficiency/templates/_helpers.tpl`

- [ ] **Step 1: 创建 _helpers.tpl**

`deploy/helm/dev-efficiency/templates/_helpers.tpl`：

```yaml
{{- define "dev-efficiency.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dev-efficiency.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "dev-efficiency.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dev-efficiency.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "dev-efficiency.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{ include "dev-efficiency.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "dev-efficiency.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "dev-efficiency.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* 集群内 Postgres 的 Service 名 */}}
{{- define "dev-efficiency.postgresHost" -}}
{{- printf "%s-postgres" (include "dev-efficiency.fullname" .) -}}
{{- end -}}

{{/* Postgres 密码：values 优先 → 复用已存在 Secret → 生成并在本次渲染内 memoize */}}
{{- define "dev-efficiency.postgresPassword" -}}
{{- if .Values.postgres.password -}}
{{- .Values.postgres.password -}}
{{- else if .Values._postgresPassword -}}
{{- .Values._postgresPassword -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace (include "dev-efficiency.postgresHost" .) -}}
{{- $val := "" -}}
{{- if and $existing (index ($existing.data | default dict) "password") -}}
{{- $val = index $existing.data "password" | b64dec -}}
{{- else -}}
{{- $val = randAlphaNum 24 -}}
{{- end -}}
{{- $_ := set .Values "_postgresPassword" $val -}}
{{- $val -}}
{{- end -}}
{{- end -}}

{{/* SESSION_SECRET：values 优先 → 复用已存在 *-env Secret → 生成并 memoize */}}
{{- define "dev-efficiency.sessionSecret" -}}
{{- if .Values.app.sessionSecret -}}
{{- .Values.app.sessionSecret -}}
{{- else if .Values._sessionSecret -}}
{{- .Values._sessionSecret -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace (printf "%s-env" (include "dev-efficiency.fullname" .)) -}}
{{- $val := "" -}}
{{- if and $existing (index ($existing.data | default dict) "SESSION_SECRET") -}}
{{- $val = index $existing.data "SESSION_SECRET" | b64dec -}}
{{- else -}}
{{- $val = randAlphaNum 48 -}}
{{- end -}}
{{- $_ := set .Values "_sessionSecret" $val -}}
{{- $val -}}
{{- end -}}
{{- end -}}

{{/* DATABASE_URL：内置库则按 Service 名拼装，否则用外部 url（必填） */}}
{{- define "dev-efficiency.databaseUrl" -}}
{{- if .Values.postgres.deploy -}}
{{- printf "postgresql://%s:%s@%s:5432/%s?schema=public" .Values.postgres.user (include "dev-efficiency.postgresPassword" .) (include "dev-efficiency.postgresHost" .) .Values.postgres.db -}}
{{- else -}}
{{- required "database.external.url is required when postgres.deploy=false" .Values.database.external.url -}}
{{- end -}}
{{- end -}}
```

- [ ] **Step 2: 验证 helper 可渲染（配合一个临时探针不需要——用 fullname 通过后续任务验证）**

Run（在 `deploy/helm/dev-efficiency`）: `helm template t . --set image.repository=r,image.tag=v >/dev/null && echo OK`
Expected: 打印 `OK`（此时仍无使用 helper 的模板，渲染应为空但不报错）。

- [ ] **Step 3: Commit**

```bash
git add deploy/helm/dev-efficiency/templates/_helpers.tpl
git commit -m "feat(helm): add naming/secret/db-url template helpers"
```

---

## Task 4: ServiceAccount / Secret / ConfigMap（pre-hook 基础资源）

**Files:**
- Create: `deploy/helm/dev-efficiency/templates/serviceaccount.yaml`
- Create: `deploy/helm/dev-efficiency/templates/secret.yaml`
- Create: `deploy/helm/dev-efficiency/templates/configmap.yaml`

- [ ] **Step 1: 创建 serviceaccount.yaml**

```yaml
{{- if .Values.serviceAccount.create }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "dev-efficiency.serviceAccountName" . }}
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-20"
    "helm.sh/hook-delete-policy": before-hook-creation
{{- end }}
```

- [ ] **Step 2: 创建 secret.yaml**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "dev-efficiency.fullname" . }}-env
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-10"
    "helm.sh/hook-delete-policy": before-hook-creation
type: Opaque
stringData:
  DATABASE_URL: {{ include "dev-efficiency.databaseUrl" . | quote }}
  SESSION_SECRET: {{ include "dev-efficiency.sessionSecret" . | quote }}
  ADMIN_EMAIL: {{ .Values.app.admin.email | quote }}
  ADMIN_PASSWORD: {{ .Values.app.admin.password | quote }}
  ADMIN_NAME: {{ .Values.app.admin.name | quote }}
  {{- if .Values.app.github.enabled }}
  GITHUB_CLIENT_ID: {{ .Values.app.github.clientId | quote }}
  GITHUB_CLIENT_SECRET: {{ .Values.app.github.clientSecret | quote }}
  GITHUB_REDIRECT_URI: {{ .Values.app.github.redirectUri | quote }}
  {{- end }}
```

- [ ] **Step 3: 创建 configmap.yaml**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "dev-efficiency.fullname" . }}-config
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-10"
    "helm.sh/hook-delete-policy": before-hook-creation
data:
  NEXT_PUBLIC_GITHUB_ENABLED: {{ .Values.app.github.enabled | ternary "1" "" | quote }}
```

- [ ] **Step 4: 验证渲染出三种资源且含正确 hook 注解**

Run（在 `deploy/helm/dev-efficiency`）:
```bash
helm template t . --set image.repository=r,image.tag=v \
  | grep -E 'kind: (ServiceAccount|Secret|ConfigMap)'
```
Expected: 三行分别出现 `kind: ServiceAccount`、`kind: Secret`、`kind: ConfigMap`。

Run（验证内置库连接串）:
```bash
helm template t . --set image.repository=r,image.tag=v | grep 'DATABASE_URL'
```
Expected: 出现 `DATABASE_URL:` 且值形如 `postgresql://devuser:...@t-dev-efficiency-postgres:5432/dev_efficiency?schema=public`。

- [ ] **Step 5: Commit**

```bash
git add deploy/helm/dev-efficiency/templates/serviceaccount.yaml deploy/helm/dev-efficiency/templates/secret.yaml deploy/helm/dev-efficiency/templates/configmap.yaml
git commit -m "feat(helm): add pre-hook serviceaccount, env secret, config"
```

---

## Task 5: 集群内 PostgreSQL（条件 pre-hook 资源）

**Files:**
- Create: `deploy/helm/dev-efficiency/templates/postgres-secret.yaml`
- Create: `deploy/helm/dev-efficiency/templates/postgres-service.yaml`
- Create: `deploy/helm/dev-efficiency/templates/postgres-statefulset.yaml`

- [ ] **Step 1: 创建 postgres-secret.yaml**

```yaml
{{- if .Values.postgres.deploy }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "dev-efficiency.postgresHost" . }}
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
    app.kubernetes.io/component: postgres
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation
type: Opaque
stringData:
  password: {{ include "dev-efficiency.postgresPassword" . | quote }}
{{- end }}
```

- [ ] **Step 2: 创建 postgres-service.yaml**

```yaml
{{- if .Values.postgres.deploy }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "dev-efficiency.postgresHost" . }}
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
    app.kubernetes.io/component: postgres
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  type: ClusterIP
  selector:
    {{- include "dev-efficiency.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: postgres
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
{{- end }}
```

- [ ] **Step 3: 创建 postgres-statefulset.yaml**

```yaml
{{- if .Values.postgres.deploy }}
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ include "dev-efficiency.postgresHost" . }}
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
    app.kubernetes.io/component: postgres
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  serviceName: {{ include "dev-efficiency.postgresHost" . }}
  replicas: 1
  selector:
    matchLabels:
      {{- include "dev-efficiency.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: postgres
  template:
    metadata:
      labels:
        {{- include "dev-efficiency.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: postgres
    spec:
      containers:
        - name: postgres
          image: {{ .Values.postgres.image }}
          env:
            - name: POSTGRES_USER
              value: {{ .Values.postgres.user | quote }}
            - name: POSTGRES_DB
              value: {{ .Values.postgres.db | quote }}
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ include "dev-efficiency.postgresHost" . }}
                  key: password
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          ports:
            - name: postgres
              containerPort: 5432
          readinessProbe:
            exec:
              command: ["sh", "-c", "pg_isready -U {{ .Values.postgres.user }} -d {{ .Values.postgres.db }}"]
            initialDelaySeconds: 5
            periodSeconds: 5
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        {{- if .Values.postgres.storage.storageClass }}
        storageClassName: {{ .Values.postgres.storage.storageClass | quote }}
        {{- end }}
        resources:
          requests:
            storage: {{ .Values.postgres.storage.size }}
{{- end }}
```

> 注：`volumeClaimTemplates` 生成的 PVC 由 StatefulSet 控制器管理，删除 StatefulSet（含 `helm uninstall`）不会删除这些 PVC，数据天然保留。

- [ ] **Step 4: 验证内置库模式渲染出三资源；外部库模式不渲染**

Run（内置库，默认）:
```bash
helm template t . --set image.repository=r,image.tag=v \
  | grep -E 'kind: (StatefulSet|Service)|component: postgres' | head
```
Expected: 出现 `kind: StatefulSet`、`kind: Service` 与多处 `app.kubernetes.io/component: postgres`。

Run（外部库模式，需提供 url 否则 required 报错）:
```bash
helm template t . \
  --set image.repository=r,image.tag=v \
  --set postgres.deploy=false \
  --set database.external.url='postgresql://u:p@ext:5432/db?schema=public' \
  | grep -c 'component: postgres'
```
Expected: 输出 `0`（外部库模式不渲染任何 postgres 资源）。

- [ ] **Step 5: Commit**

```bash
git add deploy/helm/dev-efficiency/templates/postgres-secret.yaml deploy/helm/dev-efficiency/templates/postgres-service.yaml deploy/helm/dev-efficiency/templates/postgres-statefulset.yaml
git commit -m "feat(helm): add optional in-cluster postgres (statefulset/service/secret)"
```

---

## Task 6: 迁移/seed Job（pre-hook，weight 0）

**Files:**
- Create: `deploy/helm/dev-efficiency/templates/migrate-job.yaml`

- [ ] **Step 1: 创建 migrate-job.yaml**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "dev-efficiency.fullname" . }}-migrate
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
    app.kubernetes.io/component: migrate
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "0"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  backoffLimit: 5
  template:
    metadata:
      labels:
        {{- include "dev-efficiency.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: migrate
    spec:
      restartPolicy: Never
      serviceAccountName: {{ include "dev-efficiency.serviceAccountName" . }}
      {{- with .Values.image.pullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      initContainers:
        - name: wait-for-db
          image: {{ .Values.postgres.image }}
          command:
            - sh
            - -c
            - 'until pg_isready -d "$DATABASE_URL"; do echo "waiting for database..."; sleep 2; done'
          envFrom:
            - secretRef:
                name: {{ include "dev-efficiency.fullname" . }}-env
      containers:
        - name: migrate
          image: "{{ required "image.repository is required" .Values.image.repository }}:{{ required "image.tag is required" .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          command:
            - sh
            - -c
            - 'pnpm prisma migrate deploy && pnpm db:seed'
          envFrom:
            - secretRef:
                name: {{ include "dev-efficiency.fullname" . }}-env
            - configMapRef:
                name: {{ include "dev-efficiency.fullname" . }}-config
```

- [ ] **Step 2: 验证 Job 渲染含正确 hook 权重与命令**

Run:
```bash
helm template t . --set image.repository=r,image.tag=v \
  | grep -E 'kind: Job|hook-weight|prisma migrate deploy|wait-for-db'
```
Expected: 出现 `kind: Job`、`"helm.sh/hook-weight": "0"`、`pnpm prisma migrate deploy && pnpm db:seed`、`wait-for-db`。

- [ ] **Step 3: Commit**

```bash
git add deploy/helm/dev-efficiency/templates/migrate-job.yaml
git commit -m "feat(helm): add migrate+seed pre-hook job with wait-for-db"
```

---

## Task 7: 应用 Deployment 与 Service（main 阶段）

**Files:**
- Create: `deploy/helm/dev-efficiency/templates/deployment.yaml`
- Create: `deploy/helm/dev-efficiency/templates/service.yaml`

- [ ] **Step 1: 创建 deployment.yaml**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "dev-efficiency.fullname" . }}
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "dev-efficiency.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: app
  template:
    metadata:
      labels:
        {{- include "dev-efficiency.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: app
    spec:
      serviceAccountName: {{ include "dev-efficiency.serviceAccountName" . }}
      {{- with .Values.image.pullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: app
          image: "{{ required "image.repository is required" .Values.image.repository }}:{{ required "image.tag is required" .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - secretRef:
                name: {{ include "dev-efficiency.fullname" . }}-env
            - configMapRef:
                name: {{ include "dev-efficiency.fullname" . }}-config
          readinessProbe:
            httpGet:
              path: /login
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /login
              port: http
            initialDelaySeconds: 20
            periodSeconds: 20
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

- [ ] **Step 2: 创建 service.yaml**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "dev-efficiency.fullname" . }}
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "dev-efficiency.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: app
  ports:
    - name: http
      port: {{ .Values.service.port }}
      targetPort: http
```

- [ ] **Step 3: 验证 Deployment/Service 渲染，且 Deployment 无 hook 注解（main 阶段）**

Run:
```bash
helm template t . --set image.repository=r,image.tag=v \
  | awk '/kind: Deployment/,/^---/' | grep -c 'helm.sh/hook'
```
Expected: 输出 `0`（应用 Deployment 不是 hook）。

Run:
```bash
helm template t . --set image.repository=r,image.tag=v | grep -E 'path: /login|targetPort: http'
```
Expected: 出现 `path: /login` 与 `targetPort: http`。

- [ ] **Step 4: Commit**

```bash
git add deploy/helm/dev-efficiency/templates/deployment.yaml deploy/helm/dev-efficiency/templates/service.yaml
git commit -m "feat(helm): add app deployment and service"
```

---

## Task 8: Ingress 与 cert-manager ClusterIssuer（main，条件）

**Files:**
- Create: `deploy/helm/dev-efficiency/templates/ingress.yaml`
- Create: `deploy/helm/dev-efficiency/templates/clusterissuer.yaml`

- [ ] **Step 1: 创建 ingress.yaml**

```yaml
{{- if .Values.ingress.host }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "dev-efficiency.fullname" . }}
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
  annotations:
    {{- if eq .Values.tls.mode "certManager" }}
    cert-manager.io/cluster-issuer: {{ .Values.tls.certManager.issuerName | quote }}
    {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  {{- if ne .Values.tls.mode "disabled" }}
  tls:
    - hosts:
        - {{ .Values.ingress.host | quote }}
      secretName: {{ if eq .Values.tls.mode "existingSecret" }}{{ required "tls.existingSecret is required when tls.mode=existingSecret" .Values.tls.existingSecret }}{{ else }}{{ .Values.tls.secretName }}{{ end }}
  {{- end }}
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "dev-efficiency.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
{{- end }}
```

- [ ] **Step 2: 创建 clusterissuer.yaml**

```yaml
{{- if and (eq .Values.tls.mode "certManager") .Values.tls.certManager.createClusterIssuer }}
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: {{ .Values.tls.certManager.issuerName }}
  labels:
    {{- include "dev-efficiency.labels" . | nindent 4 }}
spec:
  acme:
    server: {{ .Values.tls.certManager.acmeServer }}
    email: {{ required "tls.certManager.email is required when createClusterIssuer=true" .Values.tls.certManager.email }}
    privateKeySecretRef:
      name: {{ .Values.tls.certManager.issuerName }}-account-key
    solvers:
      - http01:
          ingress:
            class: {{ .Values.ingress.className }}
{{- end }}
```

- [ ] **Step 3: 验证 certManager 模式渲染 Ingress + ClusterIssuer 及注解**

Run:
```bash
helm template t . \
  --set image.repository=r,image.tag=v \
  --set ingress.host=demo.example.com \
  --set tls.certManager.email=ops@example.com \
  | grep -E 'kind: Ingress|kind: ClusterIssuer|cluster-issuer|secretName: dev-efficiency-tls'
```
Expected: 出现 `kind: Ingress`、`kind: ClusterIssuer`、`cert-manager.io/cluster-issuer:`、`secretName: dev-efficiency-tls`。

Run（existingSecret 模式不渲染 ClusterIssuer，引用既有 secret）:
```bash
helm template t . \
  --set image.repository=r,image.tag=v \
  --set ingress.host=demo.example.com \
  --set tls.mode=existingSecret --set tls.existingSecret=my-tls \
  | grep -E 'kind: ClusterIssuer|secretName: my-tls'
```
Expected: 出现 `secretName: my-tls`，不出现 `kind: ClusterIssuer`。

- [ ] **Step 4: Commit**

```bash
git add deploy/helm/dev-efficiency/templates/ingress.yaml deploy/helm/dev-efficiency/templates/clusterissuer.yaml
git commit -m "feat(helm): add ingress and optional cert-manager clusterissuer"
```

---

## Task 9: NOTES.txt 与生产 values 示例

**Files:**
- Create: `deploy/helm/dev-efficiency/templates/NOTES.txt`
- Create: `deploy/helm/dev-efficiency/values.prod.example.yaml`

- [ ] **Step 1: 创建 NOTES.txt**

```
dev-efficiency 已部署到 namespace「{{ .Release.Namespace }}」，release「{{ .Release.Name }}」。

1) 查看应用滚动状态：
   kubectl -n {{ .Release.Namespace }} rollout status deployment/{{ include "dev-efficiency.fullname" . }}

2) 查看迁移 Job 日志（如首次失败排查）：
   kubectl -n {{ .Release.Namespace }} logs job/{{ include "dev-efficiency.fullname" . }}-migrate

{{- if .Values.ingress.host }}
3) 访问地址：
   {{ if ne .Values.tls.mode "disabled" }}https{{ else }}http{{ end }}://{{ .Values.ingress.host }}
{{- if eq .Values.tls.mode "certManager" }}

   TLS 证书由 cert-manager 异步签发，观察：
   kubectl -n {{ .Release.Namespace }} get certificate
{{- end }}
{{- else }}
3) 未配置 ingress.host，使用 port-forward 本地访问：
   kubectl -n {{ .Release.Namespace }} port-forward svc/{{ include "dev-efficiency.fullname" . }} 3000:{{ .Values.service.port }}
{{- end }}

管理员账号：{{ .Values.app.admin.email | default "(未设置 app.admin.email，seed 已跳过)" }}
```

- [ ] **Step 2: 创建 values.prod.example.yaml**

```yaml
# 生产覆盖示例。复制后填入真实值，用 deploy.sh --values 引用。
# 切勿把真实密钥提交进 git。

image:
  repository: ghcr.io/your-org/dev-efficiency
  pullPolicy: IfNotPresent
  # pullSecrets:
  #   - name: ghcr-cred

replicaCount: 2

app:
  sessionSecret: ""            # 留空自动生成并在升级间复用；或填 ≥32 字符固定值
  admin:
    email: admin@your-org.com
    password: "change-me-please"
    name: "Admin"
  github:
    enabled: false

# 生产推荐外部托管库：
# postgres:
#   deploy: false
# database:
#   external:
#     url: postgresql://user:pass@your-db-host:5432/dev_efficiency?schema=public

postgres:
  deploy: true
  storage:
    size: 20Gi
    storageClass: ""           # 填集群的持久化 StorageClass

ingress:
  host: dev-efficiency.your-org.com
  className: nginx

tls:
  mode: certManager
  certManager:
    createClusterIssuer: true
    email: ops@your-org.com
    acmeServer: https://acme-v02.api.letsencrypt.org/directory
```

- [ ] **Step 3: 验证整 chart lint 通过**

Run（在 `deploy/helm/dev-efficiency`）:
```bash
helm lint . --set image.repository=r,image.tag=v
```
Expected: `1 chart(s) linted, 0 chart(s) failed`。

- [ ] **Step 4: Commit**

```bash
git add deploy/helm/dev-efficiency/templates/NOTES.txt deploy/helm/dev-efficiency/values.prod.example.yaml
git commit -m "feat(helm): add NOTES and production values example"
```

---

## Task 10: deploy.sh 一键脚本

**Files:**
- Create: `deploy/deploy.sh`

- [ ] **Step 1: 创建 deploy.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="${SCRIPT_DIR}/helm/dev-efficiency"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

REGISTRY="${REGISTRY:-}"
IMAGE_NAME="${IMAGE_NAME:-dev-efficiency}"
TAG="${TAG:-$(git -C "$REPO_ROOT" rev-parse --short HEAD)}"
NAMESPACE="${NAMESPACE:-dev-efficiency}"
RELEASE="${RELEASE:-dev-efficiency}"
VALUES_FILE="${VALUES_FILE:-}"
SKIP_BUILD="false"
DRY_RUN="false"

usage() {
  cat <<EOF
deploy.sh — build, push and deploy dev-efficiency to Kubernetes via Helm

Usage:
  deploy.sh --registry <reg> [options]

Options:
  --registry <reg>     镜像仓库前缀，如 ghcr.io/org（必填，或用 REGISTRY 环境变量）
  --image-name <name>  镜像名（默认 dev-efficiency）
  --tag <tag>          镜像 tag（默认 git short sha）
  --namespace <ns>     k8s namespace（默认 dev-efficiency）
  --release <name>     Helm release 名（默认 dev-efficiency）
  --values <file>      额外 values 文件（如 deploy/helm/dev-efficiency/values.prod.example.yaml）
  --skip-build         跳过 docker build/push，仅 helm 部署
  --dry-run            只打印将执行的命令，不实际执行
  -h, --help           显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry) REGISTRY="$2"; shift 2;;
    --image-name) IMAGE_NAME="$2"; shift 2;;
    --tag) TAG="$2"; shift 2;;
    --namespace) NAMESPACE="$2"; shift 2;;
    --release) RELEASE="$2"; shift 2;;
    --values) VALUES_FILE="$2"; shift 2;;
    --skip-build) SKIP_BUILD="true"; shift;;
    --dry-run) DRY_RUN="true"; shift;;
    -h|--help) usage; exit 0;;
    *) echo "unknown arg: $1" >&2; usage; exit 1;;
  esac
done

if [[ -z "$REGISTRY" ]]; then
  echo "ERROR: --registry (or REGISTRY env) is required" >&2
  usage
  exit 1
fi

IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

run() {
  echo "+ $*"
  if [[ "$DRY_RUN" == "true" ]]; then return 0; fi
  "$@"
}

if [[ "$SKIP_BUILD" != "true" ]]; then
  run docker build -t "$IMAGE" "$REPO_ROOT"
  run docker push "$IMAGE"
fi

HELM_ARGS=(upgrade --install "$RELEASE" "$CHART_DIR"
  --namespace "$NAMESPACE" --create-namespace
  --set image.repository="${REGISTRY}/${IMAGE_NAME}"
  --set image.tag="${TAG}"
  --wait --timeout 10m)
if [[ -n "$VALUES_FILE" ]]; then
  HELM_ARGS+=(-f "$VALUES_FILE")
fi

run helm "${HELM_ARGS[@]}"
run kubectl rollout status "deployment/${RELEASE}" -n "$NAMESPACE" --timeout=300s

echo "✅ 部署完成：${IMAGE} → ns/${NAMESPACE} release/${RELEASE}"
```

- [ ] **Step 2: 赋可执行权限**

Run: `chmod +x deploy/deploy.sh`

- [ ] **Step 3: 验证脚本语法与 --dry-run 输出**

Run: `bash -n deploy/deploy.sh && echo SYNTAX_OK`
Expected: 打印 `SYNTAX_OK`。

Run: `REGISTRY=ghcr.io/example deploy/deploy.sh --dry-run --tag testtag`
Expected: 依次打印 `+ docker build ...`、`+ docker push ghcr.io/example/dev-efficiency:testtag`、`+ helm upgrade --install dev-efficiency ...`、`+ kubectl rollout status ...`，且不实际执行。

- [ ] **Step 4: 验证缺少 registry 时报错退出**

Run: `deploy/deploy.sh --dry-run; echo "exit=$?"`
Expected: 打印 `ERROR: --registry (or REGISTRY env) is required` 与 `exit=1`。

- [ ] **Step 5: Commit**

```bash
git add deploy/deploy.sh
git commit -m "feat(deploy): add one-command build+push+helm deploy script"
```

---

## Task 11: 端到端验证（本地集群，可选但推荐）

**Files:** 无（仅运行验证）

> 需要本地 k8s（kind 或 minikube）并已安装 ingress-nginx 与 cert-manager。若环境不具备，跳过本任务，仅依赖前面各任务的 `helm template`/`helm lint` 渲染验证。

- [ ] **Step 1: 用 staging ACME + 自定义 values 跑一次部署**

准备 `/tmp/values.e2e.yaml`：

```yaml
app:
  admin:
    email: admin@example.com
    password: "e2e-admin-pass"
    name: "Admin"
ingress:
  host: dev-efficiency.127.0.0.1.nip.io
tls:
  mode: certManager
  certManager:
    email: ops@example.com
    acmeServer: https://acme-staging-v02.api.letsencrypt.org/directory
postgres:
  deploy: true
  storage:
    size: 1Gi
```

Run（镜像需已能被集群拉取；kind 可先 `kind load docker-image`）:
```bash
REGISTRY=<你的可拉取仓库> deploy/deploy.sh --values /tmp/values.e2e.yaml
```
Expected: 脚本结束打印 `✅ 部署完成`，`kubectl rollout status` 成功。

- [ ] **Step 2: 确认迁移 Job 成功 + admin 可登录**

Run:
```bash
kubectl -n dev-efficiency get job dev-efficiency-migrate -o jsonpath='{.status.succeeded}'; echo
```
Expected: 输出 `1`。

Run（端口转发后验证登录页可达）:
```bash
kubectl -n dev-efficiency port-forward svc/dev-efficiency 3000:3000 >/dev/null 2>&1 &
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login
```
Expected: 输出 `200`。

- [ ] **Step 3: 验证升级幂等（数据与会话保留）**

Run:
```bash
REGISTRY=<同上> deploy/deploy.sh --values /tmp/values.e2e.yaml
kubectl -n dev-efficiency get secret dev-efficiency-env -o jsonpath='{.data.SESSION_SECRET}' | base64 -d | wc -c
```
Expected: 第二次部署成功；SESSION_SECRET 字符数在两次部署间保持一致（复用未重置）。

- [ ] **Step 4: 清理（可选）**

Run:
```bash
helm -n dev-efficiency uninstall dev-efficiency
kubectl -n dev-efficiency get pvc   # Postgres PVC 应仍在，数据保留
```
Expected: release 卸载；`data-dev-efficiency-postgres-0` PVC 仍存在。

---

## Self-Review 记录

- **Spec 覆盖**：Helm chart（T2-T9）、可切换 Postgres（T5 + helper databaseUrl）、nginx Ingress + cert-manager TLS 三模式（T8）、推送镜像（T10）、迁移 hook Job + wait-for-db（T6）、Dockerfile CMD 改动（T1）、SESSION_SECRET 生成/复用（T3 helper + T4 secret + T11.3 验证）、deploy.sh（T10）、端到端验证（T11）。spec 全部要点均有对应任务。
- **Placeholder**：无 TBD/TODO；所有模板与脚本均为完整内容。
- **类型/命名一致**：`*-env`、`*-config`、`*-postgres`、`*-migrate` 后缀与 helper `dev-efficiency.fullname`/`postgresHost`/`databaseUrl`/`postgresPassword`/`sessionSecret` 在各任务中引用一致；hook 权重 -20/-10/-5/0 与「Hook 权重与阶段总览」一致。
