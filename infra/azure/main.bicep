// ============================================================================
// Zenote — Azure Container Apps Infrastructure-as-Code (Stage B + Final Remediation)
//
// Provisions:
//   - Log Analytics Workspace + Azure Application Insights
//   - User-Assigned Managed Identity (ACR Pull + Key Vault Secrets User + WIF subject)
//   - Azure Key Vault (RBAC-enabled, storing production secrets outside image/git)
//   - Azure Container Apps Managed Environment
//   - `zenote-migrator` (ACA Manual/Deploy Job running `prisma migrate deploy`)
//   - `zenote-worker`   (Dedicated BullMQ worker Container App, no external ingress)
//   - `zenote-web`      (Next.js standalone Container App, external HTTPS ingress)
//
// Two-Stage Bootstrap & Migration-First Rollout Support (`AUD-01`, `AUD-08`):
//   1. Core Infra & Key Vault Bootstrap: Set `deployContainerApps = false` on an
//      empty resource group to create Log Analytics, App Insights, Managed Identity,
//      Key Vault, and Container Apps Environment so operators can populate Key Vault
//      secrets before revisions start.
//   2. Migrator-First Rollout: Set `deployContainerApps = true` and
//      `deployWorkloadApps = false` to deploy/update `migratorJob`, execute
//      `prisma migrate deploy` until `Succeeded`, and then set
//      `deployWorkloadApps = true` to roll out `workerApp` and `webApp`.
//   3. Conditional Secret Binding: Optional provider secrets (Stripe billing,
//      Google OAuth, Google Drive client, Google webhook/token keys, Datadog,
//      API-key Gemini fallback) are controlled via explicit feature flags so ACA
//      revision provisioning never fails on unused Key Vault secrets.
// ============================================================================

targetScope = 'resourceGroup'

@description('Deployment environment name (e.g., staging or production).')
@allowed([
  'staging'
  'production'
])
param environmentName string = 'staging'

@description('Azure region for all Zenote infrastructure resources.')
param location string = resourceGroup().location

@description('Short unique resource prefix.')
@minLength(3)
@maxLength(16)
param namePrefix string = 'zenote'

@description('When false, provisions Log Analytics, App Insights, Managed Identity, Key Vault, RBAC, and ACA Environment without creating containers yet.')
param deployContainerApps bool = true

@description('When false (with deployContainerApps = true), creates/updates the migrator job without rolling out web or worker container revisions until migration succeeds.')
param deployWorkloadApps bool = true

@description('Full container image URI for zenote-web (required when deployWorkloadApps = true).')
param webImage string = ''

@description('Full container image URI for zenote-worker (required when deployWorkloadApps = true).')
param workerImage string = ''

@description('Full container image URI for zenote-migrator (required when deployContainerApps = true).')
param migratorImage string = ''

@description('Existing Azure Container Registry name (without .azurecr.io).')
param acrName string

@description('Public HTTPS base URL for NextAuth callbacks, Drive webhooks & canonical SEO links.')
param publicBaseUrl string

@description('S3/R2 storage endpoint URL (HTTPS).')
param storageEndpoint string

@description('S3/R2 storage bucket name.')
param storageBucket string

@description('S3/R2 region string (auto for Cloudflare R2).')
param storageRegion string = 'auto'

@description('Google Cloud Project ID for Vertex AI Gemini calls via WIF.')
param googleCloudProject string = ''

@description('Google Cloud Vertex AI location.')
param googleCloudLocation string = 'us-central1'

@description('Google IAM Workload Identity Provider resource audience (//iam.googleapis.com/...).')
param googleWifAudience string = ''

@description('Azure AD / Entra App ID URI federated with Google WIF.')
param googleWifAzureResource string = 'api://AzureADTokenExchange'

@description('Optional Google Service Account email impersonated after STS exchange.')
param googleWifServiceAccount string = ''

@description('Bind Key Vault secret OPENAI-API-KEY (embeddings).')
param enableOpenAiSecret bool = true

@description('Bind Key Vault secret GOOGLE-AI-API-KEY (auto-bound when googleWifAudience is empty; enables hybrid auto fallback when set with googleWifAudience).')
param enableGeminiApiKeySecret bool = false

@description('Bind Key Vault secret ASSEMBLYAI-API-KEY (speech-to-text).')
param enableAssemblyAiSecret bool = true

@description('Bind Key Vault secrets GOOGLE-CLIENT-ID and GOOGLE-CLIENT-SECRET (NextAuth Google OAuth).')
param enableGoogleOAuthSecrets bool = false

@description('Bind Key Vault secrets GOOGLE-DRIVE-CLIENT-ID and GOOGLE-DRIVE-CLIENT-SECRET.')
param enableGoogleDriveClientSecrets bool = false

@description('Bind Key Vault secret GOOGLE-TOKEN-ENCRYPTION-KEY.')
param enableGoogleTokenEncryptionSecret bool = false

@description('Bind Key Vault secret GOOGLE-WEBHOOK-SECRET.')
param enableGoogleWebhookSecret bool = false

@description('Bind Key Vault secrets STRIPE-SECRET-KEY and STRIPE-WEBHOOK-SECRET (web only).')
param enableStripeBillingSecrets bool = false

@description('Bind Key Vault secret DD-API-KEY (Datadog HTTP intake).')
param enableDatadogSecret bool = false

@description('Optional Datadog site domain (e.g. datadoghq.com or us5.datadoghq.com).')
param ddSite string = 'datadoghq.com'

@description('Optional comma-separated extra trusted redirect origins for Stripe checkout/portal.')
param allowedRedirectOrigins string = ''

@description('Optional explicit HTTPS webhook URL for Google Drive changes notifications.')
param googleDriveWebhookUrl string = ''

@description('Optional Stripe Price ID for STUDENT tier.')
param stripePriceIdStudent string = ''

@description('Optional Stripe Price ID for PRO tier.')
param stripePriceIdPro string = ''

@description('Optional Stripe Price ID for TEAM tier.')
param stripePriceIdTeam string = ''

@description('Optional Stripe Price ID for INSTITUTION tier.')
param stripePriceIdInstitution string = ''

@description('Minimum replica count for zenote-web.')
@minValue(1)
param webMinReplicas int = environmentName == 'production' ? 2 : 1

@description('Maximum replica count for zenote-web.')
@minValue(1)
param webMaxReplicas int = environmentName == 'production' ? 6 : 2

@description('Minimum replica count for zenote-worker (keep >= 1 for BullMQ & maintenance schedulers).')
@minValue(1)
param workerMinReplicas int = environmentName == 'production' ? 2 : 1

@description('Maximum replica count for zenote-worker.')
@minValue(1)
param workerMaxReplicas int = environmentName == 'production' ? 4 : 2

@description('Deployment release version tag / git SHA.')
param releaseVersion string = 'latest'

var suffix = uniqueString(resourceGroup().id, environmentName)
var appSuffix = '${namePrefix}-${environmentName}'
var keyVaultName = take(replace('${namePrefix}${environmentName}${suffix}', '-', ''), 24)
var logAnalyticsName = '${appSuffix}-logs-${take(suffix, 6)}'
var appInsightsName = '${appSuffix}-appi-${take(suffix, 6)}'
var managedEnvName = '${appSuffix}-env'
var identityName = '${appSuffix}-id'

var keyVaultSecretsUserRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var acrPullRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: environmentName == 'production' ? 90 : 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: environmentName == 'production' ? true : null
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource keyVaultRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRoleId
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, managedIdentity.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: managedEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

var kvUri = keyVault.properties.vaultUri
var bindGeminiApiKeySecret = enableGeminiApiKeySecret || empty(googleWifAudience)
var geminiAuthMode = empty(googleWifAudience)
  ? 'api_key'
  : (enableGeminiApiKeySecret ? 'auto' : 'vertex_wif')
var googleGenAiUseVertexAi = (!empty(googleWifAudience) && !enableGeminiApiKeySecret) ? 'true' : 'false'

var coreSharedSecrets = [
  {
    name: 'database-url'
    keyVaultUrl: '${kvUri}secrets/DATABASE-URL'
    identity: managedIdentity.id
  }
  {
    name: 'nextauth-secret'
    keyVaultUrl: '${kvUri}secrets/NEXTAUTH-SECRET'
    identity: managedIdentity.id
  }
  {
    name: 'upstash-redis-rest-url'
    keyVaultUrl: '${kvUri}secrets/UPSTASH-REDIS-REST-URL'
    identity: managedIdentity.id
  }
  {
    name: 'upstash-redis-rest-token'
    keyVaultUrl: '${kvUri}secrets/UPSTASH-REDIS-REST-TOKEN'
    identity: managedIdentity.id
  }
  {
    name: 'storage-access-key-id'
    keyVaultUrl: '${kvUri}secrets/STORAGE-ACCESS-KEY-ID'
    identity: managedIdentity.id
  }
  {
    name: 'storage-secret-access-key'
    keyVaultUrl: '${kvUri}secrets/STORAGE-SECRET-ACCESS-KEY'
    identity: managedIdentity.id
  }
  {
    name: 'appinsights-connection-string'
    value: appInsights.properties.ConnectionString
  }
]

var optionalOpenAiSecrets = enableOpenAiSecret
  ? [
      {
        name: 'openai-api-key'
        keyVaultUrl: '${kvUri}secrets/OPENAI-API-KEY'
        identity: managedIdentity.id
      }
    ]
  : []

var optionalGeminiSecrets = bindGeminiApiKeySecret
  ? [
      {
        name: 'google-ai-api-key'
        keyVaultUrl: '${kvUri}secrets/GOOGLE-AI-API-KEY'
        identity: managedIdentity.id
      }
    ]
  : []

var optionalAssemblyAiSecrets = enableAssemblyAiSecret
  ? [
      {
        name: 'assemblyai-api-key'
        keyVaultUrl: '${kvUri}secrets/ASSEMBLYAI-API-KEY'
        identity: managedIdentity.id
      }
    ]
  : []

var optionalGoogleOAuthSecrets = enableGoogleOAuthSecrets
  ? [
      {
        name: 'google-client-id'
        keyVaultUrl: '${kvUri}secrets/GOOGLE-CLIENT-ID'
        identity: managedIdentity.id
      }
      {
        name: 'google-client-secret'
        keyVaultUrl: '${kvUri}secrets/GOOGLE-CLIENT-SECRET'
        identity: managedIdentity.id
      }
    ]
  : []

var optionalGoogleDriveClientSecrets = enableGoogleDriveClientSecrets
  ? [
      {
        name: 'google-drive-client-id'
        keyVaultUrl: '${kvUri}secrets/GOOGLE-DRIVE-CLIENT-ID'
        identity: managedIdentity.id
      }
      {
        name: 'google-drive-client-secret'
        keyVaultUrl: '${kvUri}secrets/GOOGLE-DRIVE-CLIENT-SECRET'
        identity: managedIdentity.id
      }
    ]
  : []

var optionalGoogleTokenEncSecrets = enableGoogleTokenEncryptionSecret
  ? [
      {
        name: 'google-token-encryption-key'
        keyVaultUrl: '${kvUri}secrets/GOOGLE-TOKEN-ENCRYPTION-KEY'
        identity: managedIdentity.id
      }
    ]
  : []

var optionalGoogleWebhookSecrets = enableGoogleWebhookSecret
  ? [
      {
        name: 'google-webhook-secret'
        keyVaultUrl: '${kvUri}secrets/GOOGLE-WEBHOOK-SECRET'
        identity: managedIdentity.id
      }
    ]
  : []

var optionalDatadogSecrets = enableDatadogSecret
  ? [
      {
        name: 'dd-api-key'
        keyVaultUrl: '${kvUri}secrets/DD-API-KEY'
        identity: managedIdentity.id
      }
    ]
  : []

var optionalStripeSecrets = enableStripeBillingSecrets
  ? [
      {
        name: 'stripe-secret-key'
        keyVaultUrl: '${kvUri}secrets/STRIPE-SECRET-KEY'
        identity: managedIdentity.id
      }
      {
        name: 'stripe-webhook-secret'
        keyVaultUrl: '${kvUri}secrets/STRIPE-WEBHOOK-SECRET'
        identity: managedIdentity.id
      }
    ]
  : []

var sharedSecrets = concat(
  coreSharedSecrets,
  optionalOpenAiSecrets,
  optionalGeminiSecrets,
  optionalAssemblyAiSecrets,
  optionalGoogleOAuthSecrets,
  optionalGoogleDriveClientSecrets,
  optionalGoogleTokenEncSecrets,
  optionalGoogleWebhookSecrets,
  optionalDatadogSecrets
)

var workerSecrets = sharedSecrets
var webSecrets = concat(sharedSecrets, optionalStripeSecrets)

var sharedOptionalProviderEnv = concat(
  enableOpenAiSecret ? [{ name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }] : [],
  bindGeminiApiKeySecret ? [{ name: 'GOOGLE_AI_API_KEY', secretRef: 'google-ai-api-key' }] : [],
  enableAssemblyAiSecret ? [{ name: 'ASSEMBLYAI_API_KEY', secretRef: 'assemblyai-api-key' }] : [],
  enableGoogleOAuthSecrets
    ? [
        { name: 'GOOGLE_CLIENT_ID', secretRef: 'google-client-id' }
        { name: 'GOOGLE_CLIENT_SECRET', secretRef: 'google-client-secret' }
      ]
    : [],
  enableGoogleDriveClientSecrets
    ? [
        { name: 'GOOGLE_DRIVE_CLIENT_ID', secretRef: 'google-drive-client-id' }
        { name: 'GOOGLE_DRIVE_CLIENT_SECRET', secretRef: 'google-drive-client-secret' }
      ]
    : [],
  enableGoogleTokenEncryptionSecret
    ? [{ name: 'GOOGLE_TOKEN_ENCRYPTION_KEY', secretRef: 'google-token-encryption-key' }]
    : [],
  enableGoogleWebhookSecret
    ? [{ name: 'GOOGLE_WEBHOOK_SECRET', secretRef: 'google-webhook-secret' }]
    : [],
  !empty(googleDriveWebhookUrl)
    ? [{ name: 'GOOGLE_DRIVE_WEBHOOK_URL', value: googleDriveWebhookUrl }]
    : [],
  enableDatadogSecret
    ? [
        { name: 'DD_API_KEY', secretRef: 'dd-api-key' }
        { name: 'DD_SITE', value: ddSite }
      ]
    : []
)

var webOnlyOptionalEnv = concat(
  enableStripeBillingSecrets
    ? [
        { name: 'STRIPE_SECRET_KEY', secretRef: 'stripe-secret-key' }
        { name: 'STRIPE_WEBHOOK_SECRET', secretRef: 'stripe-webhook-secret' }
      ]
    : [],
  !empty(stripePriceIdStudent) ? [{ name: 'STRIPE_PRICE_ID_STUDENT', value: stripePriceIdStudent }] : [],
  !empty(stripePriceIdPro) ? [{ name: 'STRIPE_PRICE_ID_PRO', value: stripePriceIdPro }] : [],
  !empty(stripePriceIdTeam) ? [{ name: 'STRIPE_PRICE_ID_TEAM', value: stripePriceIdTeam }] : [],
  !empty(stripePriceIdInstitution)
    ? [{ name: 'STRIPE_PRICE_ID_INSTITUTION', value: stripePriceIdInstitution }]
    : [],
  !empty(allowedRedirectOrigins) ? [{ name: 'ALLOWED_REDIRECT_ORIGINS', value: allowedRedirectOrigins }] : []
)

// 1. One-shot Database Migration Job (`prisma migrate deploy`)
resource migratorJob 'Microsoft.App/jobs@2024-03-01' = if (deployContainerApps) {
  name: '${appSuffix}-migrator'
  location: location
  dependsOn: [
    keyVaultRoleAssignment
    acrPullAssignment
  ]
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnv.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 1
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentity.id
        }
      ]
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: '${kvUri}secrets/DATABASE-URL'
          identity: managedIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrator'
          image: migratorImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'ZENOTE_DEPLOYMENT_TARGET', value: 'azure' }
            { name: 'CLOUD_PRODUCTION_STRICT', value: 'true' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
          ]
        }
      ]
    }
  }
}

// 2. Dedicated Background Worker (`zenote-worker`) — No external ingress
resource workerApp 'Microsoft.App/containerApps@2024-03-01' = if (deployContainerApps && deployWorkloadApps) {
  name: '${appSuffix}-worker'
  location: location
  dependsOn: [
    keyVaultRoleAssignment
    acrPullAssignment
  ]
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentity.id
        }
      ]
      secrets: workerSecrets
    }
    template: {
      containers: [
        {
          name: 'zenote-worker'
          image: workerImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: concat(
            [
              { name: 'NODE_ENV', value: 'production' }
              { name: 'ZENOTE_DEPLOYMENT_TARGET', value: 'azure' }
              { name: 'CLOUD_PRODUCTION_STRICT', value: 'true' }
              { name: 'ZENOTE_SERVICE_ROLE', value: 'zenote-worker' }
              { name: 'BULLMQ_ENABLED', value: 'true' }
              { name: 'BULLMQ_DEDICATED_WORKER', value: 'true' }
              { name: 'BULLMQ_WORKER_CONCURRENCY', value: '3' }
              { name: 'WORKER_HEALTH_PORT', value: '3001' }
              { name: 'WORKER_SHUTDOWN_TIMEOUT_MS', value: '25000' }
              { name: 'LOG_FORMAT', value: 'json' }
              { name: 'SSE_REDIS_PUBSUB_ENABLED', value: 'true' }
              { name: 'NEXTAUTH_URL', value: publicBaseUrl }
              { name: 'STORAGE_PROVIDER', value: 's3' }
              { name: 'STORAGE_ENDPOINT', value: storageEndpoint }
              { name: 'STORAGE_BUCKET', value: storageBucket }
              { name: 'STORAGE_REGION', value: storageRegion }
              { name: 'AI_PROVIDER', value: 'gemini' }
              { name: 'EMBEDDING_PROVIDER', value: 'openai' }
              { name: 'SPEECH_PROVIDER', value: 'assemblyai' }
              { name: 'GEMINI_AUTH_MODE', value: geminiAuthMode }
              { name: 'GOOGLE_GENAI_USE_VERTEXAI', value: googleGenAiUseVertexAi }
              { name: 'GOOGLE_CLOUD_PROJECT', value: googleCloudProject }
              { name: 'GOOGLE_CLOUD_LOCATION', value: googleCloudLocation }
              { name: 'GOOGLE_WIF_AUDIENCE', value: googleWifAudience }
              { name: 'GOOGLE_WIF_AZURE_RESOURCE', value: googleWifAzureResource }
              { name: 'GOOGLE_WIF_SERVICE_ACCOUNT', value: googleWifServiceAccount }
              { name: 'AZURE_CLIENT_ID', value: managedIdentity.properties.clientId }
              { name: 'AZURE_KEY_VAULT_URI', value: kvUri }
              { name: 'AZURE_CLOUD_ROLE_NAME', value: '${appSuffix}-worker' }
              { name: 'DD_ENV', value: environmentName }
              { name: 'DD_SERVICE', value: 'zenote-worker' }
              { name: 'DD_VERSION', value: releaseVersion }
              { name: 'DATABASE_URL', secretRef: 'database-url' }
              { name: 'NEXTAUTH_SECRET', secretRef: 'nextauth-secret' }
              { name: 'UPSTASH_REDIS_REST_URL', secretRef: 'upstash-redis-rest-url' }
              { name: 'UPSTASH_REDIS_REST_TOKEN', secretRef: 'upstash-redis-rest-token' }
              { name: 'STORAGE_ACCESS_KEY_ID', secretRef: 'storage-access-key-id' }
              { name: 'STORAGE_SECRET_ACCESS_KEY', secretRef: 'storage-secret-access-key' }
              { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection-string' }
            ],
            sharedOptionalProviderEnv
          )
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/live'
                port: 3001
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3001
              }
              initialDelaySeconds: 10
              periodSeconds: 15
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: workerMinReplicas
        maxReplicas: workerMaxReplicas
      }
    }
  }
}

// 3. Next.js Web Application (`zenote-web`) — External HTTPS ingress
resource webApp 'Microsoft.App/containerApps@2024-03-01' = if (deployContainerApps && deployWorkloadApps) {
  name: '${appSuffix}-web'
  location: location
  dependsOn: [
    keyVaultRoleAssignment
    acrPullAssignment
  ]
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentity.id
        }
      ]
      secrets: webSecrets
    }
    template: {
      containers: [
        {
          name: 'zenote-web'
          image: webImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: concat(
            [
              { name: 'NODE_ENV', value: 'production' }
              { name: 'PORT', value: '3000' }
              { name: 'HOSTNAME', value: '0.0.0.0' }
              { name: 'ZENOTE_DEPLOYMENT_TARGET', value: 'azure' }
              { name: 'CLOUD_PRODUCTION_STRICT', value: 'true' }
              { name: 'ZENOTE_SERVICE_ROLE', value: 'zenote-web' }
              { name: 'BULLMQ_ENABLED', value: 'true' }
              { name: 'BULLMQ_DEDICATED_WORKER', value: 'true' }
              { name: 'BULLMQ_EMBEDDED_WORKER', value: 'false' }
              { name: 'BULLMQ_EMBEDDED_MAINTENANCE', value: 'false' }
              { name: 'LOG_FORMAT', value: 'json' }
              { name: 'SSE_REDIS_PUBSUB_ENABLED', value: 'true' }
              { name: 'NEXTAUTH_URL', value: publicBaseUrl }
              { name: 'NEXT_PUBLIC_SITE_URL', value: publicBaseUrl }
              { name: 'STORAGE_PROVIDER', value: 's3' }
              { name: 'STORAGE_ENDPOINT', value: storageEndpoint }
              { name: 'STORAGE_BUCKET', value: storageBucket }
              { name: 'STORAGE_REGION', value: storageRegion }
              { name: 'AI_PROVIDER', value: 'gemini' }
              { name: 'EMBEDDING_PROVIDER', value: 'openai' }
              { name: 'SPEECH_PROVIDER', value: 'assemblyai' }
              { name: 'GEMINI_AUTH_MODE', value: geminiAuthMode }
              { name: 'GOOGLE_GENAI_USE_VERTEXAI', value: googleGenAiUseVertexAi }
              { name: 'GOOGLE_CLOUD_PROJECT', value: googleCloudProject }
              { name: 'GOOGLE_CLOUD_LOCATION', value: googleCloudLocation }
              { name: 'GOOGLE_WIF_AUDIENCE', value: googleWifAudience }
              { name: 'GOOGLE_WIF_AZURE_RESOURCE', value: googleWifAzureResource }
              { name: 'GOOGLE_WIF_SERVICE_ACCOUNT', value: googleWifServiceAccount }
              { name: 'AZURE_CLIENT_ID', value: managedIdentity.properties.clientId }
              { name: 'AZURE_KEY_VAULT_URI', value: kvUri }
              { name: 'AZURE_CLOUD_ROLE_NAME', value: '${appSuffix}-web' }
              { name: 'DD_ENV', value: environmentName }
              { name: 'DD_SERVICE', value: 'zenote-web' }
              { name: 'DD_VERSION', value: releaseVersion }
              { name: 'DATABASE_URL', secretRef: 'database-url' }
              { name: 'NEXTAUTH_SECRET', secretRef: 'nextauth-secret' }
              { name: 'UPSTASH_REDIS_REST_URL', secretRef: 'upstash-redis-rest-url' }
              { name: 'UPSTASH_REDIS_REST_TOKEN', secretRef: 'upstash-redis-rest-token' }
              { name: 'STORAGE_ACCESS_KEY_ID', secretRef: 'storage-access-key-id' }
              { name: 'STORAGE_SECRET_ACCESS_KEY', secretRef: 'storage-secret-access-key' }
              { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection-string' }
            ],
            sharedOptionalProviderEnv,
            webOnlyOptionalEnv
          )
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health/live'
                port: 3000
              }
              initialDelaySeconds: 15
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: 3000
              }
              initialDelaySeconds: 15
              periodSeconds: 15
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: webMinReplicas
        maxReplicas: webMaxReplicas
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output webFqdn string = (deployContainerApps && deployWorkloadApps) ? webApp.properties.configuration.ingress.fqdn : ''
output webAppName string = (deployContainerApps && deployWorkloadApps) ? webApp.name : ''
output workerAppName string = (deployContainerApps && deployWorkloadApps) ? workerApp.name : ''
output migratorJobName string = deployContainerApps ? migratorJob.name : ''
output managedIdentityClientId string = managedIdentity.properties.clientId
output managedIdentityPrincipalId string = managedIdentity.properties.principalId
output keyVaultUri string = keyVault.properties.vaultUri
output appInsightsName string = appInsights.name
output logAnalyticsWorkspaceId string = logAnalytics.id
