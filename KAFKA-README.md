# Port Kafka Self-Service Actions - POC

A complete proof-of-concept implementation for consuming Port's Kafka Self-Service Actions in Node.js.

## 📚 Documentation

This POC includes comprehensive documentation:

1. **[KAFKA-QUICKSTART.md](./KAFKA-QUICKSTART.md)** - Get started in 5 minutes
2. **[PORT-KAFKA-POC.md](./PORT-KAFKA-POC.md)** - Complete POC documentation with:
   - Architecture diagrams
   - Workflow diagrams
   - Message structure details
   - API endpoints and usage
   - Best practices
   - Troubleshooting guide

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.kafka.example .env
# Edit .env with your credentials

# Run the consumer
npm run kafka:consumer

# Or run with example handlers
npm run kafka:example
```

## 📁 Project Structure

```
.
├── port-kafka-consumer.js          # Main Kafka consumer implementation
├── examples/
│   └── port-action-example.js      # Example custom action handlers
├── PORT-KAFKA-POC.md               # Complete POC documentation
├── KAFKA-QUICKSTART.md             # Quick start guide
├── KAFKA-README.md                 # This file
├── .env.kafka.example              # Environment template
└── package.json                    # Dependencies and scripts
```

## 🎯 What This POC Demonstrates

### 1. Kafka Consumer Setup
- ✅ Connect to Port's Kafka topic
- ✅ SASL/SCRAM-SHA-512 authentication
- ✅ Consumer group management
- ✅ Message parsing and handling

### 2. Port API Integration
- ✅ OAuth 2.0 authentication
- ✅ Token caching and refresh
- ✅ Update action run status
- ✅ Add log entries
- ✅ Create/update entities
- ✅ Link entities to action runs

### 3. Action Handling
- ✅ Route actions to specific handlers
- ✅ Extract user inputs and context
- ✅ Report progress in real-time
- ✅ Handle errors gracefully
- ✅ Provide external links

### 4. Example Implementations
- 🏗️ Scaffold Service
- 🚀 Deploy to Production
- 🗄️ Create Database
- 🔄 Run Migration
- 📊 Scale Service

## 🔑 Key Findings

### Kafka Topics

Port creates two topics per organization:

- **Actions**: `{ORG_ID}.runs` - Action invocations
- **Changes**: `{ORG_ID}.change.log` - Entity changes

### Consumer Group Naming

Must follow one of these patterns:
- `{ORG_ID}.your-consumer-name`
- Match your Port username

### Message Structure

```javascript
{
  context: {
    runId: "r_abc123",        // Use this for status updates
    blueprintIdentifier: "service",
    entity: "my-service"
  },
  payload: {
    action: {
      identifier: "deploy",   // Action type
      trigger: "CREATE",
      blueprint: "service"
    },
    properties: {             // User inputs
      version: "1.2.3",
      environment: "prod"
    },
    entity: { ... }           // Entity context
  },
  trigger: {
    by: { user: { email: "..." } },
    at: "2024-11-06T19:54:00Z"
  }
}
```

### Status Update Flow

```
1. Receive message from Kafka
2. Extract runId
3. Update status to IN_PROGRESS
4. Add log entries during execution
5. Execute business logic
6. Update status to SUCCESS/FAILURE
7. Link created entities (optional)
```

## 📊 Workflow Diagram

```
Port UI → Kafka Topic → Consumer → Action Handler → Port API
   ↓                                      ↓              ↓
 User                                  Business      Status
Triggers                               Logic         Updates
Action                                               & Logs
```

See `PORT-KAFKA-POC.md` for detailed workflow diagrams.

## 🔧 API Endpoints Used

### Authentication
```
POST https://api.getport.io/v1/auth/access_token
```

### Update Action Run
```
PATCH https://api.getport.io/v1/actions/runs/{runId}
```

### Add Logs
```
POST https://api.getport.io/v1/actions/runs/{runId}/logs
```

### Create Entity
```
POST https://api.getport.io/v1/blueprints/{id}/entities?run_id={runId}
```

## 💡 Usage Examples

### Basic Consumer

```javascript
const PortKafkaConsumer = require('./port-kafka-consumer');

const consumer = new PortKafkaConsumer({
  portClientId: 'your_client_id',
  portClientSecret: 'your_client_secret',
  orgId: 'org_abc123',
  kafkaBrokers: ['broker1:9092', 'broker2:9092'],
  kafkaUsername: 'username',
  kafkaPassword: 'password',
  consumerGroupId: 'org_abc123.my-consumer',
});

await consumer.start();
```

### Custom Action Handler

```javascript
class CustomConsumer extends PortKafkaConsumer {
  async handleAction(message) {
    const { identifier } = message.payload.action;
    
    if (identifier === 'my_action') {
      await this.handleMyAction(message);
    } else {
      await super.handleAction(message);
    }
  }

  async handleMyAction(message) {
    const runId = message.context.runId;
    const props = message.payload.properties;
    
    // Your logic here
    await this.addActionRunLog(runId, 'Processing...');
    // ...
    await this.addActionRunLog(runId, 'Done!', 'SUCCESS');
  }
}
```

## 🧪 Testing

### 1. Create Test Action in Port

```yaml
identifier: test_action
backend: kafka
inputs:
  - identifier: message
    type: string
    title: Message
```

### 2. Trigger Action

Execute from Port UI and watch consumer logs.

### 3. Verify Results

- ✅ Consumer receives message
- ✅ Status updates in Port UI
- ✅ Logs appear in action run
- ✅ Final status is SUCCESS

## 🚀 Deployment Options

### AWS Lambda
- Use Kafka trigger
- Base64 decode messages
- See Lambda example in POC docs

### Kubernetes
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: port-kafka-consumer
spec:
  replicas: 3  # Same consumer group = load balancing
  template:
    spec:
      containers:
      - name: consumer
        image: port-kafka-consumer:latest
        envFrom:
        - secretRef:
            name: port-kafka-secrets
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "port-kafka-consumer.js"]
```

## 📋 Best Practices

1. **Token Caching**: Cache Port API tokens (expire in ~1 hour)
2. **Idempotency**: Use runId to prevent duplicate processing
3. **Error Handling**: Always report failures back to Port
4. **Logging**: Provide detailed progress updates
5. **Links**: Add external links to logs, dashboards, etc.
6. **Entity Linking**: Link created entities with `run_id` parameter
7. **Graceful Shutdown**: Handle SIGTERM/SIGINT properly

## 🐛 Troubleshooting

See `PORT-KAFKA-POC.md` for detailed troubleshooting guide.

Common issues:
- Kafka connection errors → Check credentials and brokers
- Auth failures → Verify Port API credentials
- No messages → Check action backend is set to "Kafka"
- Consumer group errors → Verify naming convention

## 📖 Additional Resources

- [Port Kafka Documentation](https://docs.port.io/actions-and-automations/setup-backend/webhook/kafka/)
- [Port API Reference](https://docs.port.io/api-reference/port-api)
- [KafkaJS Documentation](https://kafka.js.org/)

## 🤝 Contributing

This is a POC implementation. Feel free to:
- Add more example handlers
- Improve error handling
- Add monitoring/metrics
- Create deployment templates

## 📝 License

ISC

---

**Status**: ✅ POC Complete and Tested  
**Created**: November 2024  
**Node.js**: 14+  
**Dependencies**: kafkajs, axios, dotenv
