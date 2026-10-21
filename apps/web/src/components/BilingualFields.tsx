import { Col, Flex, Form, Input, Row } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Rule } from 'antd/es/form';
import { TranslateFieldsButton } from '@/features/ai/TranslateFieldsButton';

/** Paired English/Arabic inputs. At least one name is required (fallback rule). */
export function BilingualFields({
  description = false,
  required = true,
  translate = true,
}: {
  description?: boolean;
  required?: boolean;
  /** Offer "✨ Translate" (AI) to fill the empty language; off for people's names. */
  translate?: boolean;
}) {
  const { t } = useTranslation();
  const oneName: Rule = ({ getFieldValue }) => ({
    validator() {
      if (!required || getFieldValue('nameEn')?.trim() || getFieldValue('nameAr')?.trim())
        return Promise.resolve();
      return Promise.reject(new Error(t('validation.nameRequired')));
    },
  });
  return (
    <>
      {translate && (
        <Flex justify="end" className="ph-ai-fields-bar">
          <TranslateFieldsButton description={description} />
        </Flex>
      )}
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item
            name="nameEn"
            label={t('fields.nameEn')}
            dependencies={['nameAr']}
            rules={[oneName, { max: 200 }]}
          >
            <Input dir="ltr" lang="en" maxLength={200} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="nameAr"
            label={t('fields.nameAr')}
            dependencies={['nameEn']}
            rules={[oneName, { max: 200 }]}
          >
            <Input dir="rtl" lang="ar" maxLength={200} />
          </Form.Item>
        </Col>
      </Row>
      {description && (
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="descriptionEn" label={t('fields.descriptionEn')}>
              <Input.TextArea dir="ltr" lang="en" rows={4} maxLength={5000} showCount />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="descriptionAr" label={t('fields.descriptionAr')}>
              <Input.TextArea dir="rtl" lang="ar" rows={4} maxLength={5000} showCount />
            </Form.Item>
          </Col>
        </Row>
      )}
    </>
  );
}
