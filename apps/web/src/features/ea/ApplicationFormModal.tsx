import { App, Col, DatePicker, Divider, Form, Input, Modal, Row, Select, TreeSelect } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import {
  APP_HOSTINGS,
  APP_LIFECYCLES,
  APP_TYPES,
  CRITICALITIES,
  DATA_CLASSIFICATIONS,
  type ApplicationDetailDto,
  type ApplicationDto,
} from '@processhub/shared';
import { useSaveEa } from '@/api/ea';
import { BilingualFields } from '@/components/BilingualFields';
import { useErrorMessage } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { UserSelect } from '@/features/governance/UserSelect';
import { CapabilitySelect } from './ea-components';
import { useEnumOptions } from './ea-helpers';

type Values = Record<string, unknown> & {
  liveFrom?: Dayjs | null;
  phaseOutFrom?: Dayjs | null;
  retiredAt?: Dayjs | null;
};

const DATES = ['liveFrom', 'phaseOutFrom', 'retiredAt'] as const;

/** Create or edit an application catalogue entry. */
export function ApplicationFormModal({
  item,
  onClose,
  onSaved,
}: {
  item?: ApplicationDto;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [form] = Form.useForm<Values>();
  const save = useSaveEa<ApplicationDetailDto>('application');
  const departments = useDepartmentTreeData();
  const types = useEnumOptions('appType', APP_TYPES);
  const hostings = useEnumOptions('hosting', APP_HOSTINGS);
  const lifecycles = useEnumOptions('lifecycle', APP_LIFECYCLES);
  const criticalities = useEnumOptions('criticality', CRITICALITIES);
  const classifications = useEnumOptions('classification', DATA_CLASSIFICATIONS);

  const initial: Values = item
    ? {
        ...item,
        businessOwnerId: item.businessOwner?.id ?? null,
        itOwnerId: item.itOwner?.id ?? null,
        departmentId: item.department?.id ?? null,
        capabilityIds: item.capabilities.map((c) => c.id),
        liveFrom: item.liveFrom ? dayjs(item.liveFrom) : null,
        phaseOutFrom: item.phaseOutFrom ? dayjs(item.phaseOutFrom) : null,
        retiredAt: item.retiredAt ? dayjs(item.retiredAt) : null,
      }
    : {
        appType: 'APPLICATION',
        hosting: 'ON_PREMISE',
        lifecycle: 'ACTIVE',
        criticality: 'MEDIUM',
        dataClassification: 'INTERNAL',
      };

  const submit = (v: Values) => {
    const body: Record<string, unknown> = {
      code: v.code || null,
      nameEn: v.nameEn ?? '',
      nameAr: v.nameAr ?? '',
      descriptionEn: v.descriptionEn ?? '',
      descriptionAr: v.descriptionAr ?? '',
      appType: v.appType,
      vendor: v.vendor ?? '',
      version: v.version ?? '',
      businessOwnerId: v.businessOwnerId ?? null,
      itOwnerId: v.itOwnerId ?? null,
      departmentId: v.departmentId ?? null,
      hosting: v.hosting,
      hostingCountry: ((v.hostingCountry as string) ?? '').toUpperCase(),
      lifecycle: v.lifecycle,
      criticality: v.criticality,
      dataClassification: v.dataClassification,
      licenceNotes: v.licenceNotes ?? '',
      url: v.url || null,
      capabilityIds: v.capabilityIds ?? [],
    };
    for (const d of DATES) body[d] = v[d] ? v[d]!.format('YYYY-MM-DD') : null;
    save.mutate(
      { id: item?.id, body },
      {
        onSuccess: (r) => {
          message.success(t('saved'));
          onSaved?.(r.item.id);
          onClose();
        },
        onError: (err) => message.error(errorMessage(err)),
      },
    );
  };

  return (
    <Modal
      open
      width={860}
      title={item ? t('ea:applications.edit') : t('ea:applications.new')}
      okText={t('save')}
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={initial} onFinish={submit}>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="code" label={t('ea:fields.code')}>
              <Input dir="ltr" maxLength={50} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="appType" label={t('ea:fields.type')}>
              <Select options={types} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="lifecycle" label={t('ea:fields.lifecycle')}>
              <Select options={lifecycles} />
            </Form.Item>
          </Col>
        </Row>
        <BilingualFields description />
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="vendor" label={t('ea:fields.vendor')}>
              <Input maxLength={200} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="version" label={t('ea:fields.version')}>
              <Input dir="ltr" maxLength={100} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="criticality" label={t('ea:fields.criticality')}>
              <Select options={criticalities} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="businessOwnerId" label={t('ea:fields.businessOwner')}>
              <UserSelect allowClear known={item?.businessOwner ? [item.businessOwner] : []} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="itOwnerId" label={t('ea:fields.itOwner')}>
              <UserSelect allowClear known={item?.itOwner ? [item.itOwner] : []} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="departmentId" label={t('ea:fields.department')}>
              <TreeSelect treeData={departments} allowClear treeDefaultExpandAll showSearch />
            </Form.Item>
          </Col>
        </Row>
        <Divider />
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="hosting" label={t('ea:fields.hosting')}>
              <Select options={hostings} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="hostingCountry"
              label={t('ea:fields.hostingCountry')}
              extra={t('ea:fields.hostingCountryHint')}
              rules={[{ pattern: /^[A-Za-z]{2}$/, message: t('grc:excel.issue.INVALID_COUNTRY') }]}
            >
              <Input dir="ltr" maxLength={2} style={{ textTransform: 'uppercase' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="dataClassification" label={t('ea:fields.dataClassification')}>
              <Select options={classifications} />
            </Form.Item>
          </Col>
          {DATES.map((d) => (
            <Col xs={24} md={8} key={d}>
              <Form.Item name={d} label={t(`ea:fields.${d}`)}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          ))}
        </Row>
        <Form.Item name="capabilityIds" label={t('ea:fields.capabilities')}>
          <CapabilitySelect multiple />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="url"
              label={t('ea:fields.url')}
              rules={[{ pattern: /^https?:\/\/\S+$/i, message: t('grc:excel.issue.INVALID_URL') }]}
            >
              <Input dir="ltr" maxLength={1000} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="licenceNotes" label={t('ea:fields.licenceNotes')}>
              <Input.TextArea rows={2} maxLength={5000} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
