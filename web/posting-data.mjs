// Keep static snapshots and live detail pages on the same public listing scope.
// Deliberately exclude the source body and contact information.
export const POSTING_FIELDS = [
  'id', 'ij_id', 'title', 'company_name', 'region', 'work_region', 'employment_type',
  'hiring_status', 'headcount', 'career', 'salary', 'education', 'posted_at',
  'deadline', 'detail_url', 'job_category', 'original_posted_at', 'repost_count',
  'removed_at', 'is_expired', 'view_count', 'source', 'audience', 'is_big4',
  'career_min_years', 'career_max_years',
].join(',');

export const POSTING_SCOPE = '(and(source.eq.kicpa:trainee,or(is_target.is.true,is_expired.is.true)),' +
  'and(source.eq.kicpa:cpa,audience.eq.cpa,or(is_target.is.true,is_expired.is.true)))';
