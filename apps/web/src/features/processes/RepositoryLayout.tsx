import { Layout } from 'antd';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { DIAGRAM_NODE_PREFIX, ProcessTree } from './ProcessTree';

/** Process tree on the inline-start side (left in LTR, right in RTL) with the selected page beside it. */
export function RepositoryLayout() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const selected = id && pathname.startsWith('/diagrams/') ? `${DIAGRAM_NODE_PREFIX}${id}` : id;
  return (
    <Layout hasSider className="ph-repo">
      <Layout.Sider
        width={300}
        theme="light"
        className="ph-repo-sider"
        breakpoint="md"
        collapsedWidth={0}
      >
        <ProcessTree selectedId={selected} />
      </Layout.Sider>
      <Layout.Content className="ph-repo-content">
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
