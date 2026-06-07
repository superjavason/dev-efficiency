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
