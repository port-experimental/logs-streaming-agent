/**
 * Artillery processor for generating dynamic test data
 */

module.exports = {
  generateRunId,
  generateServiceName,
};

function generateRunId(context, events, done) {
  context.vars.runId = `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  return done();
}

function generateServiceName(context, events, done) {
  const services = ['api-service', 'web-service', 'worker-service', 'scheduler-service'];
  context.vars.serviceName = services[Math.floor(Math.random() * services.length)];
  return done();
}

