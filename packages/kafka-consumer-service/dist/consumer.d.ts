/**
 * Port Kafka Self-Service Actions Consumer with CI/CD Integration
 */
import 'dotenv/config';
interface PortConfig {
    portClientId: string;
    portClientSecret: string;
    orgId: string;
    kafkaBrokers: string[];
    kafkaUsername: string;
    kafkaPassword: string;
    consumerGroupId: string;
}
declare class PortKafkaConsumer {
    private config;
    private portApiUrl;
    private accessToken;
    private tokenExpiry;
    private kafka;
    private consumer;
    private actionsTopic;
    private isConnected;
    private isShuttingDown;
    constructor(config: Partial<PortConfig>);
    private validateConfig;
    private setupKafkaErrorHandlers;
    private reconnect;
    getAccessToken(): Promise<string>;
    updateActionRun(runId: string, updates: any): Promise<any>;
    addActionRunLog(runId: string, message: string, terminationStatus?: string, statusLabel?: string): Promise<any>;
    private processActionMessage;
    private initializeProviders;
    start(): Promise<void>;
    shutdown(): Promise<void>;
}
export default PortKafkaConsumer;
//# sourceMappingURL=consumer.d.ts.map