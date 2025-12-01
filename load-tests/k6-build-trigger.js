/**
 * k6 Load Test Script for Build Trigger Endpoint
 * 
 * Usage: k6 run load-tests/k6-build-trigger.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 users
    { duration: '1m', target: 50 },    // Sustained load at 50 users
    { duration: '30s', target: 100 },  // Peak load at 100 users
    { duration: '1m', target: 50 },      // Ramp down to 50 users
    { duration: '30s', target: 0 },     // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests should be below 500ms
    http_req_failed: ['rate<0.01'],   // Error rate should be less than 1%
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

function generateRunId() {
  return `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateServiceName() {
  const services = ['api-service', 'web-service', 'worker-service', 'scheduler-service'];
  return services[Math.floor(Math.random() * services.length)];
}

export default function () {
  const payload = JSON.stringify({
    context: {
      runId: generateRunId(),
      by: {
        email: 'load-test@example.com',
      },
    },
    action: {
      identifier: 'deploy_microservice_kafka',
    },
    properties: {
      serviceName: generateServiceName(),
      version: `${Math.floor(Math.random() * 10) + 1}.0.0`,
      environment: ['dev', 'staging', 'prod'][Math.floor(Math.random() * 3)],
      branch: 'main',
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: {
      name: 'TriggerBuild',
    },
  };

  const res = http.post(`${BASE_URL}/webhook/jenkins`, payload, params);

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
    'response has runId': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.runId !== undefined;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!success);

  sleep(1);
}

export function handleSummary(data) {
  return {
    'stdout': JSON.stringify(data, null, 2),
  };
}

