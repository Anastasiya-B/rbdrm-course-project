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

@Entity({ name: 'products' })
@Index('idx_products_search_vector', { synchronize: false })
@Check('products_name_not_empty', 'length(trim(name)) > 0')
@Check('products_description_not_empty', 'length(trim(description)) > 0')
@Check('products_price_positive', 'price > 0')
@Check('products_stock_non_negative', 'stock_quantity >= 0')
export class Product {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'owner_id', type: 'bigint' })
  ownerId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({
    type: 'integer',
    comment: 'Price in minor currency units',
  })
  price!: number;

  @Column({
    name: 'stock_quantity',
    type: 'integer',
    default: 0,
  })
  stockQuantity!: number;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
  })
  isActive!: boolean;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @Column({
    name: 'search_vector',
    type: 'tsvector',
    asExpression: "to_tsvector('simple', name || ' ' || description)",
    generatedType: 'STORED',
  })
  searchVector!: string;

  @ManyToOne(() => User, user => user.products, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'products_owner_fk',
  })
  owner!: User;

  @OneToMany(() => OrderItem, orderItem => orderItem.product)
  orderItems!: OrderItem[];
}
