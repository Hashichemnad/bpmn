import { Link } from 'react-router-dom';
import { Badge, Table, Typography, type TabsProps } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AssuranceTasksDto, ControlTestDto, GrcChangeDto, IssueDto } from '@processhub/shared';
import { IssueStatusTag, SeverityTag } from './assurance-tags';
import { AssigneeLabel, TestStatusTag } from './assurance-tags';
import { useAssuranceTasks } from '@/api/assurance';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { grcItemPath } from '@/features/grc/grc-helpers';

type Key = keyof AssuranceTasksDto;

/** Tabs of My tasks for assurance work (Phase 4.2), with their counts. */
export function useAssuranceTaskTabs(portal = false): {
  items: NonNullable<TabsProps['items']>;
  counts: Record<string, number>;
} {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const q = useAssuranceTasks();
  const d = q.data;
  if (!d) return { items: [], counts: {} };
  const counts = Object.fromEntries(
    (Object.keys(d) as Key[]).map((k) => [k, (d[k] as unknown[]).length]),
  );
  const label = (key: Key, title: string) => (
    <span>
      {title}{' '}
      <Badge
        count={counts[key]}
        size="small"
        color={counts[key] ? '#1d4ed8' : '#cbd5e1'}
        showZero
      />
    </span>
  );
  const person = (u: GrcChangeDto['submittedBy']) => (u ? loc(u) || u.email : '—');

  const items: NonNullable<TabsProps['items']> = [];
  if (d.grcChanges.length) {
    items.push({
      key: 'grcChanges',
      label: label('grcChanges', t('assurance:changes.tabTitle')),
      children: (
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={d.grcChanges}
          columns={[
            {
              title: t('assurance:changes.item'),
              render: (_, c) => (
                <Link to={grcItemPath(c.object.type, c.object.id)}>
                  {c.object.code && <span dir="ltr">{c.object.code} </span>}
                  {loc(c.object)}
                </Link>
              ),
            },
            {
              title: t('assurance:changes.fieldsChanged'),
              render: (_, c) =>
                c.fields
                  .map((f) => t(`assurance:changes.fields.${f.field}`, { defaultValue: f.field }))
                  .join(', '),
            },
            {
              title: t('assurance:changes.proposedBy'),
              render: (_, c) => (
                <Typography.Text>
                  {person(c.submittedBy)} · {formatDate(c.submittedAt)}
                </Typography.Text>
              ),
            },
          ]}
        />
      ),
    });
  }
  const testTable = (list: ControlTestDto[], testId: string) => (
    <Table
      rowKey="id"
      size="middle"
      pagination={false}
      dataSource={list}
      data-testid={testId}
      columns={[
        {
          title: t('assurance:tests.control'),
          render: (_, r) => (
            <Link to={`/grc/tests/${r.id}`}>
              {r.control.code && <span dir="ltr">{r.control.code} </span>}
              {loc(r.control)}
            </Link>
          ),
        },
        { title: t('assurance:tests.period'), dataIndex: 'period' },
        {
          title: t('assurance:tests.statusLabel'),
          render: (_, r) => <TestStatusTag status={r.status} />,
        },
        {
          title: t('assurance:tests.tester'),
          render: (_, r) => <AssigneeLabel value={r.tester} />,
        },
        {
          title: t('assurance:tests.due'),
          render: (_, r) => (
            <Typography.Text type={r.overdue ? 'danger' : undefined}>
              {formatDate(r.dueAt, false)}
            </Typography.Text>
          ),
        },
      ]}
    />
  );
  if (d.testsToExecute.length)
    items.push({
      key: 'testsToExecute',
      label: label('testsToExecute', t('assurance:tasks.testsToExecute')),
      children: testTable(d.testsToExecute, 'tasks-tests-execute'),
    });
  if (d.testsToReview.length)
    items.push({
      key: 'testsToReview',
      label: label('testsToReview', t('assurance:tasks.testsToReview')),
      children: testTable(d.testsToReview, 'tasks-tests-review'),
    });
  const issuePath = (id: string) => (portal ? `/portal/issues/${id}` : `/grc/issues/${id}`);
  const issueTable = (list: IssueDto[], testId: string) => (
    <Table
      rowKey="id"
      size="middle"
      pagination={false}
      dataSource={list}
      data-testid={testId}
      columns={[
        {
          title: t('assurance:issues.titleLabel'),
          render: (_, r) => (
            <Link to={issuePath(r.id)}>
              <span dir="ltr">{r.code}</span> {loc(r, 'title')}
            </Link>
          ),
        },
        {
          title: t('assurance:issues.severity'),
          render: (_, r) => <SeverityTag value={r.severity} />,
        },
        {
          title: t('assurance:issues.statusLabel'),
          render: (_, r) => <IssueStatusTag status={r.status} />,
        },
        {
          title: t('assurance:issues.due'),
          render: (_, r) => (
            <Typography.Text type={r.overdue ? 'danger' : undefined}>
              {formatDate(r.dueAt, false)}
            </Typography.Text>
          ),
        },
      ]}
    />
  );
  if (d.issues.length)
    items.push({
      key: 'issues',
      label: label('issues', t('assurance:tasks.issues')),
      children: issueTable(d.issues, 'tasks-issues'),
    });
  if (d.issueActions.length)
    items.push({
      key: 'issueActions',
      label: label('issueActions', t('assurance:tasks.issueActions')),
      children: (
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={d.issueActions}
          data-testid="tasks-actions"
          columns={[
            {
              title: t('assurance:issues.actionTitle'),
              render: (_, a) => <Link to={issuePath(a.issue.id)}>{loc(a, 'title')}</Link>,
            },
            {
              title: t('assurance:issues.titleLabel'),
              render: (_, a) => (
                <>
                  <span dir="ltr">{a.issue.code}</span> {loc(a.issue, 'title')}
                </>
              ),
            },
            { title: t('assurance:issues.progress'), render: (_, a) => `${a.progress}%` },
            {
              title: t('assurance:issues.due'),
              render: (_, a) => (
                <Typography.Text type={a.overdue ? 'danger' : undefined}>
                  {formatDate(a.dueAt, false)}
                </Typography.Text>
              ),
            },
          ]}
        />
      ),
    });
  if (d.issuesToVerify.length)
    items.push({
      key: 'issuesToVerify',
      label: label('issuesToVerify', t('assurance:tasks.issuesToVerify')),
      children: issueTable(d.issuesToVerify, 'tasks-verify'),
    });
  if (d.findingsToAnswer.length)
    items.push({
      key: 'findingsToAnswer',
      label: label('findingsToAnswer', t('assurance:tasks.findingsToAnswer')),
      children: (
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={d.findingsToAnswer}
          data-testid="tasks-findings"
          columns={[
            {
              title: t('assurance:audits.finding'),
              render: (_, f) => (
                <Link to={portal ? `/portal/findings/${f.id}` : `/grc/findings/${f.id}`}>
                  <span dir="ltr">{f.code}</span> {loc(f, 'title')}
                </Link>
              ),
            },
            {
              title: t('assurance:audits.engagement'),
              render: (_, f) => (
                <>
                  <span dir="ltr">{f.engagement.code}</span> {loc(f.engagement, 'title')}
                </>
              ),
            },
            {
              title: t('assurance:audits.rating'),
              render: (_, f) => <SeverityTag value={f.rating} />,
            },
          ]}
        />
      ),
    });
  return { items, counts };
}
