import {
	StatusCheckRepository,
	UptimeStats,
} from '../../domain/repositories/StatusCheckRepository';
import {
	StatusCheck,
	CreateStatusCheckRequest,
	ServiceStatus,
} from '../../domain/entities/StatusCheck';

export class D1StatusCheckRepository implements StatusCheckRepository {
	constructor(private db: D1Database) {}

	async findByServiceId(serviceId: number, limit: number = 100): Promise<StatusCheck[]> {
		const result = await this.db
			.prepare('SELECT * FROM status_checks WHERE service_id = ? ORDER BY checked_at DESC LIMIT ?')
			.bind(serviceId, limit)
			.all<StatusCheck>();
		return result.results.map(this.mapToStatusCheck);
	}

	async findLatestByServiceId(serviceId: number): Promise<StatusCheck | null> {
		const result = await this.db
			.prepare('SELECT * FROM status_checks WHERE service_id = ? ORDER BY checked_at DESC LIMIT 1')
			.bind(serviceId)
			.first<StatusCheck>();
		return result ? this.mapToStatusCheck(result) : null;
	}

	async findRecent(hours: number): Promise<StatusCheck[]> {
		const result = await this.db
			.prepare(
				'SELECT * FROM status_checks WHERE checked_at >= datetime("now", "-" || ? || " hours") ORDER BY checked_at DESC'
			)
			.bind(hours)
			.all<StatusCheck>();
		return result.results.map(this.mapToStatusCheck);
	}

	async create(statusCheck: CreateStatusCheckRequest): Promise<StatusCheck> {
		const result = await this.db
			.prepare(
				`
				INSERT INTO status_checks (service_id, status, response_time_ms, status_code, error_message)
				VALUES (?, ?, ?, ?, ?)
				RETURNING *
			`
			)
			.bind(
				statusCheck.serviceId,
				statusCheck.status,
				statusCheck.responseTimeMs || null,
				statusCheck.statusCode || null,
				statusCheck.errorMessage || null
			)
			.first<StatusCheck>();

		if (!result) {
			throw new Error('Failed to create status check');
		}

		return this.mapToStatusCheck(result);
	}

	async findByServiceIdInTimeRange(
		serviceId: number,
		startTime: Date,
		endTime: Date
	): Promise<StatusCheck[]> {
		const results = await this.db
			.prepare(
				`
				SELECT * FROM status_checks 
				WHERE service_id = ? 
				AND checked_at >= ? 
				AND checked_at <= ?
				ORDER BY checked_at DESC
			`
			)
			.bind(serviceId, startTime.toISOString(), endTime.toISOString())
			.all<any>();

		return results.results.map(row => this.mapToStatusCheck(row));
	}

	async getUptimeStats(serviceId: number, since: Date): Promise<UptimeStats> {
		// `checked_at` is stored in SQLite canonical form ('YYYY-MM-DD HH:MM:SS').
		// `since.toISOString()` produces '...T...Z' which sorts wrong against that
		// canonical form via plain string compare. Wrapping the param in datetime()
		// normalises it so both sides are comparable.
		const row = await this.db
			.prepare(
				`SELECT
					COUNT(*) AS total,
					SUM(CASE WHEN status IN ('up', 'degraded') THEN 1 ELSE 0 END) AS up
				FROM status_checks
				WHERE service_id = ? AND checked_at >= datetime(?)`
			)
			.bind(serviceId, since.toISOString())
			.first<{ total: number; up: number | null }>();

		return {
			total: row?.total ?? 0,
			up: row?.up ?? 0,
		};
	}

	async findBucketedSince(
		serviceId: number,
		since: Date,
		bucketSeconds: number
	): Promise<StatusCheck[]> {
		// One row per bucket, prioritising worst status then most recent within bucket.
		// Status priority: down(0) > degraded(1) > others(2). ROW_NUMBER picks rank=1.
		// See getUptimeStats for the datetime(?) wrapping rationale.
		const result = await this.db
			.prepare(
				`WITH bucketed AS (
					SELECT
						id, service_id, status, response_time_ms, status_code, error_message, checked_at,
						CAST(strftime('%s', checked_at) / ? AS INTEGER) AS bucket
					FROM status_checks
					WHERE service_id = ? AND checked_at >= datetime(?)
				),
				ranked AS (
					SELECT *, ROW_NUMBER() OVER (
						PARTITION BY bucket
						ORDER BY
							CASE status
								WHEN 'down' THEN 0
								WHEN 'degraded' THEN 1
								ELSE 2
							END,
							checked_at DESC
					) AS rn
					FROM bucketed
				)
				SELECT id, service_id, status, response_time_ms, status_code, error_message, checked_at
				FROM ranked
				WHERE rn = 1
				ORDER BY checked_at`
			)
			.bind(bucketSeconds, serviceId, since.toISOString())
			.all<any>();

		return result.results.map(row => this.mapToStatusCheck(row));
	}

	async deleteOld(olderThanDays: number): Promise<number> {
		const result = await this.db
			.prepare('DELETE FROM status_checks WHERE checked_at < datetime("now", "-" || ? || " days")')
			.bind(olderThanDays)
			.run();
		return result.meta?.changes || 0;
	}

	private mapToStatusCheck(row: any): StatusCheck {
		return {
			id: row.id,
			serviceId: row.service_id,
			status: row.status as ServiceStatus,
			responseTimeMs: row.response_time_ms,
			statusCode: row.status_code,
			errorMessage: row.error_message,
			checkedAt: new Date(row.checked_at),
		};
	}
}
