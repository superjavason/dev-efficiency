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

# Mirror the chart's "dev-efficiency.fullname" helper: the Deployment is named
# after the release unless the release name already contains the chart name,
# in which case the chart name is appended.
if [[ "$RELEASE" == *dev-efficiency* ]]; then
  DEPLOY_NAME="$RELEASE"
else
  DEPLOY_NAME="${RELEASE}-dev-efficiency"
fi
run kubectl rollout status "deployment/${DEPLOY_NAME}" -n "$NAMESPACE" --timeout=300s

echo "✅ 部署完成：${IMAGE} → ns/${NAMESPACE} release/${RELEASE}"
