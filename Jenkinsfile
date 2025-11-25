pipeline {
  agent { docker { image 'node:20-alpine' } }
  
  parameters {
    string(name: 'SERVICE_NAME', defaultValue: 'your-node-app', description: 'Service name to deploy')
    string(name: 'VERSION', defaultValue: '1.0.0', description: 'Version or tag to deploy')
    string(name: 'ENVIRONMENT', defaultValue: 'dev', description: 'Target environment (dev/staging/prod)')
    string(name: 'CHANGE_REASON', defaultValue: '', description: 'Reason for this deployment')
    string(name: 'PORT_RUN_ID', defaultValue: '', description: 'Port action run ID for tracking')
  }
  
  stages {
    stage('Deployment Info') {
      steps {
        echo '=========================================='
        echo 'Deployment Information'
        echo '=========================================='
        echo "Service: ${params.SERVICE_NAME}"
        echo "Version: ${params.VERSION}"
        echo "Environment: ${params.ENVIRONMENT}"
        echo "Reason: ${params.CHANGE_REASON}"
        echo "Port Run ID: ${params.PORT_RUN_ID}"
        echo '=========================================='
      }
    }
    
    stage('Checkout'){
      steps {
        echo '📥 Checking out source code...'
        checkout scm
        sleep 10
      }
    }
    stage('Install'){ steps { sh 'npm ci || npm i' } }
    stage('Test'){
      steps {
        echo '🧪 Running tests...'
        sh 'npm test'
        sleep 10
      }
    }
    stage('Build'){
      steps {
        echo '🔨 Building application...'
        sh 'npm run build'
        sleep 10
      }
    }
    
    stage('Deploy') {
      steps {
        sleep 10
        echo "Deploying ${params.SERVICE_NAME} v${params.VERSION} to ${params.ENVIRONMENT}..."
        sleep 10
        // Add your actual deployment logic here
        // For example:
        // sh "kubectl set image deployment/${params.SERVICE_NAME} ${params.SERVICE_NAME}=${params.VERSION} -n ${params.ENVIRONMENT}"
        // sh "helm upgrade ${params.SERVICE_NAME} ./charts --set image.tag=${params.VERSION} --namespace ${params.ENVIRONMENT}"
        echo '✅ Deployment completed'
      }
    }
  }
  
  post {
    always {
      script {
        // Send webhook notification after build completes
        // Use host.docker.internal to reach host machine from Docker container
        def webhookUrl = env.WEBHOOK_URL ?: 'http://host.docker.internal:3000/webhook'
        def payload = [
          jobName: env.JOB_NAME,
          buildNumber: env.BUILD_NUMBER,
          buildUrl: env.BUILD_URL,
          status: currentBuild.result ?: 'SUCCESS',
          duration: currentBuild.duration,
          timestamp: currentBuild.startTimeInMillis
        ]
        
        try {
          // Requires HTTP Request Plugin
          httpRequest(
            url: webhookUrl,
            httpMode: 'POST',
            contentType: 'APPLICATION_JSON',
            requestBody: groovy.json.JsonOutput.toJson(payload),
            validResponseCodes: '200:299',
            timeout: 10
          )
          echo "✅ Webhook notification sent successfully"
        } catch (Exception e) {
          echo "⚠️  Failed to send webhook: ${e.message}"
          // Don't fail the build if webhook fails
        }
      }
    }
  }
}
