import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Order } from './order.entity';

export const POST_PROCESSING_TASK_STATUSES = ['pending', 'done'] as const;

export type PostProcessingTaskStatus =
  (typeof POST_PROCESSING_TASK_STATUSES)[number];

@Entity({ name: 'post_processing_tasks' })
@Index('idx_post_processing_tasks_status_id', ['status', 'id'])
@Check('post_processing_tasks_status_valid', "status IN ('pending', 'done')")
@Check('post_processing_tasks_processed_non_negative', 'processed >= 0')
export class PostProcessingTask {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'order_id', type: 'bigint' })
  orderId!: string;

  @Column({
    type: 'text',
    default: 'order_confirmation',
  })
  type!: string;

  @Column({
    type: 'text',
    default: 'pending',
  })
  status!: PostProcessingTaskStatus;

  @Column({
    type: 'integer',
    default: 0,
  })
  processed!: number;

  @Column({
    name: 'worker_id',
    type: 'text',
    nullable: true,
  })
  workerId!: string | null;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @Column({
    name: 'processed_at',
    type: 'timestamptz',
    nullable: true,
  })
  processedAt!: Date | null;

  @ManyToOne(() => Order, order => order.postProcessingTasks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'post_processing_tasks_order_fk',
  })
  order!: Order;
}
