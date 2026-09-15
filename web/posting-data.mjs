// Keep static snapshots and live detail pages on the same public listing scope.
// Summary fields stay separate so related-job queries do not fetch full documents.
export const POSTING_FIELDS = [
  'id', 'ij_id', 'title', 'company_name', 'region', 'work_region', 'employment_type',
  'hiring_status', 'headcount', 'career', 'salary', 'education', 'posted_at', 'first_seen_at',
  'deadline', 'detail_url', 'job_category', 'original_posted_at', 'repost_count',
  'removed_at', 'is_expired', 'view_count', 'source', 'audience', 'is_big4',
  'career_min_years', 'career_max_years', 'region_group', 'original_id', 'content_hash',
  'recruitment_categories', 'company_type', 'source_categories', 'source_company_type',
  'work_types', 'contract_types', 'cpa_preferred', 'application_methods', 'form_type', 'taxonomy_needs_review',
].join(',');
export const POSTING_CONTENT_FIELDS = 'body,source_content,content_fetched_at';

export const POSTING_SCOPE = '(source.eq.kicpa:trainee,source.eq.kicpa:cpa,source.eq.kicpa:association)';
