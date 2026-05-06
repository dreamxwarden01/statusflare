import { StatusCheck, CreateStatusCheckRequest } from '../entities/StatusCheck';

export interface UptimeStats {
	total: number;
	up: number; // count of checks with status 'up' or 'degraded'
}

export interface StatusCheckRepository {
	findByServiceId(serviceId: number, limit?: number): Promise<StatusCheck[]>;
	findByServiceIdInTimeRange(
		serviceId: number,
		startTime: Date,
		endTime: Date
	): Promise<StatusCheck[]>;
	findLatestByServiceId(serviceId: number): Promise<StatusCheck | null>;
	findRecent(hours: number): Promise<StatusCheck[]>;
	/** Aggregate uptime counts since `since`. Avoids pulling rows when only counts are needed. */
	getUptimeStats(serviceId: number, since: Date): Promise<UptimeStats>;
	/**
	 * Returns at most one StatusCheck per fixed-size bucket starting at `since`.
	 * Within a bucket, prefers status priority: down > degraded > others, then most recent.
	 * Used to sample ~90 rows out of ~1440 for status-page rendering.
	 */
	findBucketedSince(
		serviceId: number,
		since: Date,
		bucketSeconds: number
	): Promise<StatusCheck[]>;
	create(statusCheck: CreateStatusCheckRequest): Promise<StatusCheck>;
	deleteOld(olderThanDays: number): Promise<number>;
}
