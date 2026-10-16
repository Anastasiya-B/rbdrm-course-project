# Restore Drill

## Date

2026-09-30

## Backup

Backup format: PostgreSQL custom format (`pg_dump -Fc`)

Backup size:

```text
24K
```

## Verification

Source checksum:

```text
10|8378600
```

Restored checksum:

```text
10|8378600
```

Result:

```text
MATCH
```

The checksum contains the order row count and the sum of `orders.total_amount`.

## RTO

Measured restore time:

```text
7 seconds
```

RTO (Recovery Time Objective) for the current local restore procedure is approximately **7 seconds**.

## RPO

Backups are scheduled once per day.

RPO (Recovery Point Objective) is therefore **up to 24 hours**.

In the worst case, a failure immediately before the next scheduled backup could result in losing changes made since the previous nightly backup.
