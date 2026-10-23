/** Arabic translations for bpmn-js palette, context pad and tooltips. */
const AR: Record<string, string> = {
  'Activate create/remove space tool': 'أداة إضافة/إزالة المساحة',
  'Activate global connect tool': 'أداة الربط',
  'Activate hand tool': 'أداة اليد',
  'Activate lasso tool': 'أداة التحديد',
  'Add lane above': 'إضافة مسار أعلى',
  'Add lane below': 'إضافة مسار أسفل',
  'Add text annotation': 'إضافة ملاحظة نصية',
  'Append compensation activity': 'إلحاق نشاط تعويض',
  'Append conditional intermediate catch event': 'إلحاق حدث شرطي وسيط',
  'Append end event': 'إلحاق حدث نهاية',
  'Append gateway': 'إلحاق بوابة',
  'Append intermediate/boundary event': 'إلحاق حدث وسيط/حدّي',
  'Append message intermediate catch event': 'إلحاق حدث رسالة وسيط',
  'Append receive task': 'إلحاق مهمة استلام',
  'Append signal intermediate catch event': 'إلحاق حدث إشارة وسيط',
  'Append task': 'إلحاق مهمة',
  'Append timer intermediate catch event': 'إلحاق حدث مؤقت وسيط',
  'Change element': 'تغيير العنصر',
  'Connect to other element': 'الربط بعنصر آخر',
  'Connect using association': 'الربط بعلاقة',
  'Connect using data input association': 'الربط بعلاقة إدخال بيانات',
  'Create data object reference': 'إنشاء كائن بيانات',
  'Create data store reference': 'إنشاء مخزن بيانات',
  'Create end event': 'إنشاء حدث نهاية',
  'Create expanded sub-process': 'إنشاء عملية فرعية موسعة',
  'Create gateway': 'إنشاء بوابة',
  'Create group': 'إنشاء مجموعة',
  'Create intermediate/boundary event': 'إنشاء حدث وسيط/حدّي',
  'Create pool/participant': 'إنشاء مسبح/مشارك',
  'Create start event': 'إنشاء حدث بداية',
  'Create task': 'إنشاء مهمة',
  Delete: 'حذف',
  'Divide into three lanes': 'تقسيم إلى ثلاثة مسارات',
  'Divide into two lanes': 'تقسيم إلى مسارين',
  'Search in diagram': 'البحث في المخطط',
  'Set color': 'تعيين اللون',
  'Reset to theme': 'إعادة ألوان النمط',
  'No colour': 'بدون لون',
  'Start / end event': 'حدث البداية / النهاية',
  'Successful end': 'نهاية ناجحة',
  'Rejected end': 'نهاية مرفوضة',
  'Human task': 'مهمة بشرية',
  'Approval task': 'مهمة اعتماد',
  'System task': 'مهمة نظام',
  Gateway: 'بوابة',
  'Intermediate event': 'حدث وسيط',
  Lane: 'مسار',
  White: 'أبيض',
  'Light grey': 'رمادي فاتح',
  Grey: 'رمادي',
  Purple: 'بنفسجي',
};

export const translations = { ar: AR };

/**
 * bpmn-js translate module. Reads the locale from a shared state object so the
 * modeler does not need to be recreated when the language changes.
 */
export function translateModule(state: { locale: string }) {
  const translate = (template: string, replacements: Record<string, string> = {}) =>
    ((state.locale === 'ar' ? AR[template] : undefined) ?? template).replace(
      /{([^}]+)}/g,
      (_, key: string) => replacements[key] ?? `{${key}}`,
    );
  return { translate: ['value', translate] };
}
