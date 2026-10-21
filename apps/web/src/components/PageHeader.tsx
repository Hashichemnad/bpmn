import { Breadcrumb, Flex, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface Crumb {
  title: ReactNode;
  to?: string;
}

export function PageHeader({
  title,
  subtitle,
  extra,
  crumbs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <div className="ph-page-header">
      {crumbs && crumbs.length > 0 && (
        <Breadcrumb
          style={{ marginBottom: 8 }}
          items={crumbs.map((c) => ({ title: c.to ? <Link to={c.to}>{c.title}</Link> : c.title }))}
        />
      )}
      <Flex justify="space-between" align="center" gap={16} wrap="wrap">
        <div style={{ minWidth: 0 }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
        </div>
        {extra && <Flex gap={8} wrap="wrap">{extra}</Flex>}
      </Flex>
    </div>
  );
}
