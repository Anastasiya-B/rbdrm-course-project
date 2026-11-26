# Restore Drill

## Date

2026-11-25

## Backup

Backup format: PostgreSQL custom format (`pg_dump -Fc`)

Backup file:

```text
backups/marketplace_2026-11-25_15-24-54.dump
```

Backup size:

```text
48K
```

## Verification

Source checksum:

```text
32|8880400
```

Restored checksum:

```text
32|8880400
```

Result:

```text
MATCH
```

The checksum contains the order row count and the sum of `orders.total_amount`.

## RTO

Measured restore time:

```text
6 seconds
```

RTO (Recovery Time Objective) for the current local restore procedure is approximately **6 seconds** in the isolated Docker restore drill. The drill exited successfully with `MATCH`.

## RPO

Backups are scheduled once per day.

RPO (Recovery Point Objective) is therefore **up to 24 hours**.

In the worst case, a failure immediately before the next scheduled backup could result in losing changes made since the previous nightly backup.
