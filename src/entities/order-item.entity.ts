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
import { Product } from './product.entity';

@Entity({ name: 'order_items' })
@Index('idx_order_items_order_id', ['orderId'])
@Check('order_items_quantity_positive', 'quantity > 0')
@Check('order_items_price_positive', 'unit_price > 0')
export class OrderItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'order_id', type: 'bigint' })
  orderId!: string;

  @Column({ name: 'product_id', type: 'bigint' })
  productId!: string;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({
    name: 'unit_price',
    type: 'integer',
    comment: 'Unit price in minor currency units',
  })
  unitPrice!: number;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @ManyToOne(() => Order, order => order.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'order_items_order_fk',
  })
  order!: Order;

  @ManyToOne(() => Product, product => product.orderItems, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'order_items_product_fk',
  })
  product!: Product;
}
