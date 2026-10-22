let sequence = 0;

function nextId(): number {
  sequence += 1;
  return sequence;
}

export function aUser(
  overrides: Partial<{
    email: string;
    fullName: string;
    balance: number;
  }> = {},
) {
  const id = nextId();

  return {
    email: `user-${id}@example.com`,
    fullName: `Test User ${id}`,
    balance: 100000,
    ...overrides,
  };
}

export function aProduct(
  ownerId: string,
  overrides: Partial<{
    name: string;
    description: string | null;
    price: number;
    stockQuantity: number;
    isActive: boolean;
  }> = {},
) {
  const id = nextId();

  return {
    ownerId,
    name: `Test Product ${id}`,
    description: `Test product description ${id}`,
    price: 10000 + id,
    stockQuantity: 10,
    isActive: true,
    ...overrides,
  };
}
