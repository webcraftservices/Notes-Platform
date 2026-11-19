// ============================================================================
// Zenote — Azure Monitor / Application Insights Scheduled Alert Rules (Stage C)
//
// Monitors critical production failure modes:
//   1. Processing job failures spike (`processing_job.failures` / `worker.job.failed`)
//   2. AI provider unavailability / failure spike (`ai.generation.failures`)
//   3. Elevated server error logs (`severityLevel >= 3`) across web or worker
//   4. Container App readiness failures / database unreachable events
// ============================================================================

targetScope = 'resourceGroup'

@description('Deployment environment name (staging or production).')
param environmentName string = 'staging'

@description('Azure region for scheduled query alert rules.')
param location string = resourceGroup().location

@description('Resource ID of the Log Analytics Workspace backing Zenote ACA & App Insights.')
param logAnalyticsWorkspaceId string

@description('Action Group resource IDs notified when alerts fire (optional).')
param actionGroupIds array = []

var alertPrefix = 'zenote-${environmentName}'

resource workerJobFailureAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: '${alertPrefix}-worker-job-failures'
  location: location
  properties: {
    description: 'Alert when BullMQ processing jobs fail repeatedly in a 15-minute window.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [
      logAnalyticsWorkspaceId
    ]
    criteria: {
      allOf: [
        {
          query: 'AppMetrics | where Name in ("processing_job.failures", "worker.job.failed") | summarize FailureCount = sum(Sum) by bin(TimeGenerated, 5m)'
          timeAggregation: 'Total'
          metricMeasureColumn: 'FailureCount'
          operator: 'GreaterThanOrEqual'
          threshold: 5
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: actionGroupIds
    }
  }
}

resource serverErrorLogAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: '${alertPrefix}-server-5xx-errors'
  location: location
  properties: {
    description: 'Alert when zenote-web or zenote-worker emits a sustained spike of error telemetry.'
    severity: 1
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT10M'
    scopes: [
      logAnalyticsWorkspaceId
    ]
    criteria: {
      allOf: [
        {
          query: 'AppTraces | where SeverityLevel >= 3 | summarize ErrorCount = count() by bin(TimeGenerated, 5m)'
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 10
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: actionGroupIds
    }
  }
}

resource aiFailureSpikeAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: '${alertPrefix}-ai-availability-degraded'
  location: location
  properties: {
    description: 'Alert when Gemini Vertex AI / OpenAI calls experience elevated failures.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [
      logAnalyticsWorkspaceId
    ]
    criteria: {
      allOf: [
        {
          query: 'AppMetrics | where Name == "ai.generation.failures" | summarize AiFailures = sum(Sum) by bin(TimeGenerated, 5m)'
          timeAggregation: 'Total'
          metricMeasureColumn: 'AiFailures'
          operator: 'GreaterThanOrEqual'
          threshold: 5
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: actionGroupIds
    }
  }
}

resource containerAppUnhealthyAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: '${alertPrefix}-health-db-unreachable'
  location: location
  properties: {
    description: 'Critical alert if web/worker loses PostgreSQL connectivity or logs fatal startup errors.'
    severity: 0
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [
      logAnalyticsWorkspaceId
    ]
    criteria: {
      allOf: [
        {
          query: 'ContainerAppConsoleLogs_CL | where Log_s has "[api:health]" or Log_s has "worker_health_unhealthy" or Log_s has "fatal_startup_error" or Log_s has "runtime_config_validation_failed" or Log_s has "key_vault_hydration_failed"'
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: actionGroupIds
    }
  }
}
