import { Layout } from 'antd';
import { Outlet, useParams } from 'react-router-dom';
import { ProcessTree } from './ProcessTree';

/** Process tree on the inline-start side (left in LTR, right in RTL) with the selected page beside it. */
export function RepositoryLayout() {
  const { id } = useParams();
  return (
    <Layout hasSider className="ph-repo">
      <Layout.Sider
        width={300}
        theme="light"
        className="ph-repo-sider"
        breakpoint="md"
        collapsedWidth={0}
      >
        <ProcessTree selectedId={id} />
      </Layout.Sider>
      <Layout.Content className="ph-repo-content">
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
