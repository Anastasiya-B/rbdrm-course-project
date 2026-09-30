import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from './user.entity';
import { OrderItem } from './order-item.entity';

export const ORDER_STATUSES = [
  'created',
  'paid',
  'shipped',
  'completed',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

@Entity({ name: 'orders' })
@Index('idx_orders_user_created_at', ['userId', 'createdAt'])
@Check('orders_total_non_negative', 'total_amount >= 0')
@Check(
  'orders_status_valid',
  "status IN ('created', 'paid', 'shipped', 'completed', 'cancelled')",
)
export class Order {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: string;

  @Column({
    type: 'text',
    default: 'created',
  })
  status!: OrderStatus;

  @Column({
    name: 'total_amount',
    type: 'integer',
    comment: 'Order total in minor currency units',
  })
  totalAmount!: number;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @ManyToOne(() => User, user => user.orders, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'orders_user_fk',
  })
  user!: User;

  @OneToMany(() => OrderItem, orderItem => orderItem.order)
  items!: OrderItem[];
}
