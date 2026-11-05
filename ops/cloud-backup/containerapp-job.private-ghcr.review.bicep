// REVIEW ONLY: no resource creation, approvals or live operation are authorized.
targetScope = 'resourceGroup'

@allowed(['malaysiawest'])
param location string = 'malaysiawest'
param containerAppsEnvironmentResourceId string
@minLength(64)
@maxLength(64)
param ghcrImageSha256 string
param ghcrReadOnlyUsername string
param registryPullVaultReaderIdentityResourceId string
param ghcrPullTokenKeyVaultSecretUrl string
param postgresCaKeyVaultSecretUrl string
param stagingKeyVaultUrl string
param pgStagingHost string
param pgStagingUser string
param agePublicRecipient string

resource manualBackupJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'campuspool-staging-backup-job'
  location: location
  tags: {
    project: 'campuspool'
    environment: 'staging'
    purpose: 'manual-encrypted-backup'
  }
  identity: {
    type: 'SystemAssigned,UserAssigned'
    userAssignedIdentities: {
      '${registryPullVaultReaderIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironmentResourceId
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: 'ghcr.io'
          username: ghcrReadOnlyUsername
          passwordSecretRef: 'ghcr-pull-token'
        }
      ]
      secrets: [
        {
          name: 'ghcr-pull-token'
          keyVaultUrl: ghcrPullTokenKeyVaultSecretUrl
          identity: registryPullVaultReaderIdentityResourceId
        }
        {
          name: 'staging-pg-root-ca'
          keyVaultUrl: postgresCaKeyVaultSecretUrl
          identity: registryPullVaultReaderIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'backup-worker'
          image: 'ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:${ghcrImageSha256}'
          args: [
            '--preflight'
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'AZURE_AUTH_MODE', value: 'managed-identity' }
            { name: 'CAMPUSPOOL_CLOUD_WORKER', value: 'YES' }
            { name: 'AZURE_KEYVAULT_URL', value: stagingKeyVaultUrl }
            { name: 'AZURE_PG_SECRET_NAME', value: 'campuspool-staging-pg-password' }
            { name: 'PGHOST', value: pgStagingHost }
            { name: 'PGPORT', value: '5432' }
            { name: 'PGDATABASE', value: 'postgres' }
            { name: 'PGUSER', value: pgStagingUser }
            { name: 'PGSSLMODE', value: 'verify-full' }
            { name: 'PGSSLROOTCERT', value: '/mnt/staging-ca/ca.pem' }
            { name: 'AGE_RECIPIENT', value: agePublicRecipient }
            { name: 'AZURE_STORAGE_ACCOUNT', value: '011campuspoolbackup' }
            { name: 'AZURE_BACKUP_CONTAINER', value: 'campuspool-staging-backups' }
            { name: 'AZURE_PRIVATE_CONTAINER_CONFIRMED', value: 'YES' }
          ]
          volumeMounts: [
            {
              volumeName: 'staging-pg-ca'
              mountPath: '/mnt/staging-ca'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'staging-pg-ca'
          storageType: 'Secret'
          secrets: [
            {
              secretRef: 'staging-pg-root-ca'
              path: 'ca.pem'
            }
          ]
        }
      ]
    }
  }
}
