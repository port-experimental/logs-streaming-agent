pipeline {
  agent { docker { image 'node:20-alpine' } }
  
  stages {
    stage('Checkout'){ steps { checkout scm } }
    stage('Install'){ steps { sh 'npm ci || npm i' } }
    stage('Test'){ steps { sh 'npm test' } }
    stage('Build'){ steps { sh 'npm run build' } }
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
