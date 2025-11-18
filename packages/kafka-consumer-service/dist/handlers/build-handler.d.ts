/**
 * Build action handler - triggers CI/CD builds and streams logs to Port
 */
import type PortKafkaConsumer from '../consumer';
export declare function handleBuildAction(message: any, consumer: PortKafkaConsumer): Promise<void>;
//# sourceMappingURL=build-handler.d.ts.map