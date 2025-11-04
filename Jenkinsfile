pipeline {
  agent any
  tools { nodejs 'Node20' }
  stages {
    stage('Checkout'){ steps { checkout scm } }
    stage('Install'){ steps { sh 'npm ci || npm i' } }
    stage('Test'){ steps { sh 'npm test' } }
    stage('Build'){ steps { sh 'npm run build' } }
  }
}
