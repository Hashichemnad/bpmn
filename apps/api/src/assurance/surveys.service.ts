import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  PERMISSIONS,
  PROCESS_FEEDBACK_DEFINITION,
  answerProblems,
  isQuestionVisible,
  proposalsFromAnswers,
  scoreAnswers,
  type Answers,
  type Audience,
  type CampaignDetailDto,
  type CampaignDto,
  type CampaignResultsDto,
  type CampaignStatus,
  type CreateCampaignInput,
  type CreateQuestionnaireInput,
  type FeedbackRequestInput,
  type GrcObjectType,
  type Locale,
  type MyResponseDto,
  type ProposalDecisionInput,
  type ProposalField,
  type QuestionnaireDefinition,
  type QuestionnaireDto,
  type QuestionnaireStatus,
  type ResponseProgress,
  type SaveAnswersInput,
  type SurveyProposalDto,
  type SurveyPurpose,
  type UpdateCampaignInput,
  type UpdateQuestionnaireInput,
  type UserRef,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ContentService } from '../governance/content.service';
import { GrcService } from '../grc/grc.service';
import { AssuranceFilesService } from './assurance-files.service';

const userSelect = { id: true, email: true, nameEn: true, nameAr: true } as const;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const day = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
const toDay = (v: string | null | undefined) => (v === undefined ? undefined : v ? day(v) : null);
const DAY = 86_400_000;
const responseLink = (id: string) => `/surveys/${id}`;
const campaignInclude = {
  responses: { select: { status: true } },
  proposals: { where: { status: 'PENDING' }, select: { id: true } },
} satisfies Prisma.SurveyCampaignInclude;
type CampaignRow = Prisma.SurveyCampaignGetPayload<{ include: typeof campaignInclude }>;

const questionCount = (d: QuestionnaireDefinition) =>
  d.sections.reduce((n, s) => n + s.questions.length, 0);

/**
 * Questionnaires and survey campaigns (Phase 4.2, D-102): builder, campaigns to users / roles /
 * departments with reminders, response tracking, results and Excel export; self-assessment answers
 * propose ratings for Risk & Compliance to accept; "Request feedback" on a process sends a short
 * questionnaire whose answers become comments on the process.
 */
@Injectable()
export class SurveysService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly content: ContentService,
    private readonly grc: GrcService,
    private readonly files: AssuranceFilesService,
  ) {}

  onModuleInit() {
    this.files.register('SURVEY_RESPONSE', {
      canRead: async (id, user) => {
        const r = await this.prisma.surveyResponse.findUnique({
          where: { id },
          include: { campaign: true },
        });
        return !!r && (r.userId === user.id || (await this.mayManageCampaign(r.campaign, user)));
      },
      canWrite: async (id, user) => {
        const r = await this.prisma.surveyResponse.findUnique({
          where: { id },
          include: { campaign: true },
        });
        return (
          !!r && r.userId === user.id && r.status !== 'SUBMITTED' && r.campaign.status === 'OPEN'
        );
      },
    });
  }

  // ---------- Access ----------

  private manages(user: AuthUser) {
    return user.permissions.has(PERMISSIONS.SURVEYS_MANAGE);
  }

  /** Survey managers; the requester of a process feedback campaign sees its results too. */
  private async mayManageCampaign(
    c: { createdById: string | null; purpose: string; processId: string | null },
    user: AuthUser,
  ) {
    if (this.manages(user)) return true;
    if (c.purpose === 'PROCESS_FEEDBACK' && c.processId) {
      if (c.createdById === user.id) return true;
      const item = await this.content.find('PROCESS', c.processId, user);
      return !!item?.canEdit;
    }
    return false;
  }

  // ---------- Questionnaires ----------

  private qDto(
    q: Prisma.QuestionnaireGetPayload<{ include: { _count: { select: { campaigns: true } } } }>,
  ): QuestionnaireDto {
    const definition = q.definition as unknown as QuestionnaireDefinition;
    return {
      id: q.id,
      titleEn: q.titleEn,
      titleAr: q.titleAr,
      descriptionEn: q.descriptionEn,
      descriptionAr: q.descriptionAr,
      purpose: q.purpose as SurveyPurpose,
      definition,
      status: q.status as QuestionnaireStatus,
      questionCount: questionCount(definition),
      campaignCount: q._count.campaigns,
      updatedAt: q.updatedAt.toISOString(),
    };
  }

  async questionnaires() {
    const rows = await this.prisma.questionnaire.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { campaigns: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((q) => this.qDto(q));
  }

  async questionnaire(id: string) {
    const q = await this.prisma.questionnaire.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { campaigns: true } } },
    });
    if (!q) throw notFound('Questionnaire');
    return this.qDto(q);
  }

  /** Linked risks / controls of a self-assessment must exist. */
  private async assertLinks(d: QuestionnaireDefinition | undefined) {
    const links = (d?.sections ?? []).flatMap((s) => s.questions).filter((q) => q.link);
    for (const q of links) {
      const type = q.link!.field === 'EFFECTIVENESS' ? 'CONTROL' : 'RISK';
      if (
        !(await this.prisma.repoObject.count({
          where: { id: q.link!.objectId, type, deletedAt: null },
        }))
      )
        throw badRequest(`INVALID_${type}_REFERENCE`);
    }
  }

  async createQuestionnaire(input: CreateQuestionnaireInput, actor: AuthUser, meta: RequestMeta) {
    await this.assertLinks(input.definition);
    const q = await this.prisma.$transaction(async (tx) => {
      const row = await tx.questionnaire.create({
        data: {
          titleEn: input.titleEn ?? '',
          titleAr: input.titleAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          purpose: input.purpose ?? 'GENERAL',
          definition: input.definition as unknown as Prisma.InputJsonValue,
          status: input.status ?? 'DRAFT',
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Questionnaire',
          entityId: row.id,
          userId: actor.id,
          summary: { title: row.titleEn || row.titleAr, purpose: row.purpose },
          meta,
        },
        tx,
      );
      return row;
    });
    return this.questionnaire(q.id);
  }

  async updateQuestionnaire(
    id: string,
    input: UpdateQuestionnaireInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    await this.questionnaire(id);
    await this.assertLinks(input.definition);
    await this.prisma.$transaction(async (tx) => {
      await tx.questionnaire.update({
        where: { id },
        data: {
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          purpose: input.purpose,
          definition: input.definition as unknown as Prisma.InputJsonValue | undefined,
          status: input.status,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Questionnaire',
          entityId: id,
          userId: actor.id,
          summary: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
    });
    return this.questionnaire(id);
  }

  async removeQuestionnaire(id: string, actor: AuthUser, meta: RequestMeta) {
    await this.questionnaire(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.questionnaire.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Questionnaire',
          entityId: id,
          userId: actor.id,
          summary: {},
          meta,
        },
        tx,
      );
    });
  }

  // ---------- Campaigns ----------

  private async campaignDtos(rows: CampaignRow[]): Promise<CampaignDto[]> {
    const audiences = rows.map((c) => (c.audience ?? {}) as Partial<Audience>);
    const [users, departments, processes] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: audiences.flatMap((a) => a.userIds ?? []) } },
        select: userSelect,
      }),
      this.prisma.department.findMany({
        where: {
          id: {
            in: [
              ...audiences.flatMap((a) => a.departmentIds ?? []),
              ...rows.map((c) => c.departmentId).filter((v): v is string => !!v),
            ],
          },
        },
        select: { id: true, nameEn: true, nameAr: true },
      }),
      this.prisma.process.findMany({
        where: { id: { in: rows.map((c) => c.processId).filter((v): v is string => !!v) } },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
    ]);
    return rows.map((c, i) => {
      const a = audiences[i];
      const counts: Record<ResponseProgress, number> = { SENT: 0, OPENED: 0, SUBMITTED: 0 };
      for (const r of c.responses) counts[r.status as ResponseProgress]++;
      const total = c.responses.length;
      return {
        id: c.id,
        questionnaireId: c.questionnaireId,
        titleEn: c.titleEn,
        titleAr: c.titleAr,
        purpose: c.purpose as SurveyPurpose,
        status: c.status as CampaignStatus,
        audience: {
          userIds: a.userIds ?? [],
          roleKeys: a.roleKeys ?? [],
          departmentIds: a.departmentIds ?? [],
        },
        audienceLabels: {
          users: users.filter((u) => a.userIds?.includes(u.id)),
          departments: departments.filter((d) => a.departmentIds?.includes(d.id)),
        },
        startAt: iso(c.startAt),
        endAt: iso(c.endAt),
        reminderDaysBefore: c.reminderDaysBefore,
        process: processes.find((p) => p.id === c.processId) ?? null,
        department: departments.find((d) => d.id === c.departmentId) ?? null,
        launchedAt: iso(c.launchedAt),
        closedAt: iso(c.closedAt),
        counts,
        responseRate: total ? Math.round((counts.SUBMITTED / total) * 100) : 0,
        pendingProposals: c.proposals.length,
        createdAt: c.createdAt.toISOString(),
      };
    });
  }

  private async campaignRow(id: string) {
    const c = await this.prisma.surveyCampaign.findFirst({
      where: { id, deletedAt: null },
      include: campaignInclude,
    });
    if (!c) throw notFound('Campaign');
    return c;
  }

  async campaigns(
    q: { status?: CampaignStatus; purpose?: SurveyPurpose; processId?: string },
    user: AuthUser,
  ) {
    const rows = await this.prisma.surveyCampaign.findMany({
      where: { deletedAt: null, status: q.status, purpose: q.purpose, processId: q.processId },
      include: campaignInclude,
      orderBy: { createdAt: 'desc' },
    });
    const visible = [];
    for (const r of rows) if (await this.mayManageCampaign(r, user)) visible.push(r);
    return this.campaignDtos(visible);
  }

  async campaign(id: string, user: AuthUser): Promise<CampaignDetailDto> {
    const c = await this.campaignRow(id);
    if (!(await this.mayManageCampaign(c, user))) throw notFound('Campaign');
    const [dto] = await this.campaignDtos([c]);
    const responses = await this.prisma.surveyResponse.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: responses.map((r) => r.userId) } },
      select: userSelect,
    });
    const byId = new Map<string, UserRef>(users.map((u) => [u.id, u]));
    return {
      ...dto,
      definition: c.definition as unknown as QuestionnaireDefinition,
      responses: responses.map((r) => ({
        id: r.id,
        user: byId.get(r.userId) ?? { id: r.userId, email: '', nameEn: '', nameAr: '' },
        status: r.status as ResponseProgress,
        openedAt: iso(r.openedAt),
        submittedAt: iso(r.submittedAt),
        score: r.score,
        maxScore: r.maxScore,
      })),
    };
  }

  async createCampaign(input: CreateCampaignInput, actor: AuthUser, meta: RequestMeta) {
    const q = await this.prisma.questionnaire.findFirst({
      where: { id: input.questionnaireId, deletedAt: null },
    });
    if (!q) throw badRequest('INVALID_QUESTIONNAIRE');
    if (q.status === 'ARCHIVED') throw badRequest('QUESTIONNAIRE_ARCHIVED');
    const c = await this.prisma.$transaction(async (tx) => {
      const row = await tx.surveyCampaign.create({
        data: {
          questionnaireId: q.id,
          titleEn: input.titleEn || q.titleEn,
          titleAr: input.titleAr || q.titleAr,
          descriptionEn: q.descriptionEn,
          descriptionAr: q.descriptionAr,
          purpose: q.purpose,
          definition: q.definition as Prisma.InputJsonValue,
          audience: (input.audience ?? {
            userIds: [],
            roleKeys: [],
            departmentIds: [],
          }) as Prisma.InputJsonValue,
          startAt: input.startAt ? day(input.startAt) : null,
          endAt: input.endAt ? day(input.endAt) : null,
          reminderDaysBefore: input.reminderDaysBefore ?? 3,
          processId: input.processId ?? null,
          departmentId: input.departmentId ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'SurveyCampaign',
          entityId: row.id,
          userId: actor.id,
          summary: { questionnaireId: q.id, title: row.titleEn || row.titleAr },
          meta,
        },
        tx,
      );
      return row;
    });
    return this.campaign(c.id, actor);
  }

  async updateCampaign(id: string, input: UpdateCampaignInput, actor: AuthUser, meta: RequestMeta) {
    const c = await this.campaignRow(id);
    if (c.status === 'CLOSED') throw conflict('CAMPAIGN_CLOSED');
    if (c.status === 'OPEN' && input.audience)
      throw conflict('CAMPAIGN_LAUNCHED', 'The recipients are fixed once launched');
    await this.prisma.$transaction(async (tx) => {
      await tx.surveyCampaign.update({
        where: { id },
        data: {
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          audience: input.audience as Prisma.InputJsonValue | undefined,
          startAt: toDay(input.startAt),
          endAt: toDay(input.endAt),
          reminderDaysBefore: input.reminderDaysBefore,
          processId: input.processId,
          departmentId: input.departmentId,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'SurveyCampaign',
          entityId: id,
          userId: actor.id,
          summary: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
    });
    return this.campaign(id, actor);
  }

  /** Recipients: named users, users with a role, users of a department — who may answer. */
  private async recipients(a: Audience) {
    if (!a.userIds.length && !a.roleKeys.length && !a.departmentIds.length) return [];
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        OR: [
          { id: { in: a.userIds } },
          { roles: { some: { role: { key: { in: a.roleKeys } } } } },
          { departmentId: { in: a.departmentIds } },
        ],
        roles: {
          some: {
            role: { permissions: { some: { permission: { key: PERMISSIONS.SURVEYS_RESPOND } } } },
          },
        },
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  async launch(id: string, actor: AuthUser, meta: RequestMeta) {
    const c = await this.campaignRow(id);
    if (!(await this.mayManageCampaign(c, actor))) throw notFound('Campaign');
    if (c.status !== 'DRAFT') throw conflict('CAMPAIGN_LAUNCHED');
    if (c.endAt && c.endAt < new Date()) throw badRequest('END_IN_PAST');
    const userIds = await this.recipients(c.audience as unknown as Audience);
    if (!userIds.length)
      throw badRequest('NO_RECIPIENTS', 'Nobody in the audience can answer questionnaires');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.surveyCampaign.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'OPEN', launchedAt: new Date(), startAt: c.startAt ?? new Date() },
      });
      if (!res.count) throw conflict('CAMPAIGN_LAUNCHED');
      await tx.surveyResponse.createMany({
        data: userIds.map((userId) => ({ campaignId: id, userId })),
        skipDuplicates: true,
      });
      await this.audit.log(
        {
          action: 'PUBLISH',
          entityType: 'SurveyCampaign',
          entityId: id,
          userId: actor.id,
          summary: { recipients: userIds.length },
          meta,
        },
        tx,
      );
    });
    const responses = await this.prisma.surveyResponse.findMany({ where: { campaignId: id } });
    for (const r of responses) await this.notify(c, r, 'invited', actor.id);
    return this.campaign(id, actor);
  }

  private notify(
    c: { titleEn: string; titleAr: string; endAt: Date | null },
    r: { id: string; userId: string },
    kind: 'invited' | 'reminder',
    actorId: string | null,
    dedupeKey?: string,
  ) {
    return this.notifications.notify({
      userIds: [r.userId],
      type: 'SURVEY',
      actorId,
      params: { kind, titleEn: c.titleEn, titleAr: c.titleAr, due: c.endAt?.toISOString() ?? '' },
      link: responseLink(r.id),
      dedupeKey,
    });
  }

  async close(id: string, actor: AuthUser | null, meta?: RequestMeta) {
    const c = await this.campaignRow(id);
    if (actor && !(await this.mayManageCampaign(c, actor))) throw notFound('Campaign');
    if (c.status !== 'OPEN') throw conflict('INVALID_TRANSITION');
    await this.prisma.$transaction(async (tx) => {
      await tx.surveyCampaign.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      await this.audit.log(
        {
          action: 'ARCHIVE',
          entityType: 'SurveyCampaign',
          entityId: id,
          userId: actor?.id ?? null,
          summary: { automatic: !actor },
          meta,
        },
        tx,
      );
    });
    return actor ? this.campaign(id, actor) : null;
  }

  async removeCampaign(id: string, actor: AuthUser, meta: RequestMeta) {
    const c = await this.campaignRow(id);
    if (c.status !== 'DRAFT') throw conflict('CAMPAIGN_LAUNCHED');
    await this.prisma.$transaction(async (tx) => {
      await tx.surveyCampaign.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'SurveyCampaign',
          entityId: id,
          userId: actor.id,
          summary: {},
          meta,
        },
        tx,
      );
    });
  }

  /** "Request feedback" on a process: the built-in questionnaire, launched at once. */
  async requestFeedback(input: FeedbackRequestInput, actor: AuthUser, meta: RequestMeta) {
    const item = await this.content.load('PROCESS', input.processId, actor);
    if (!this.manages(actor) && !item.canEdit)
      throw forbidden('Only editors of the process may ask for feedback');
    const c = await this.prisma.$transaction(async (tx) => {
      const row = await tx.surveyCampaign.create({
        data: {
          titleEn: `Feedback: ${item.code ?? ''} ${item.titleEn || item.titleAr}`
            .replace(/\s+/g, ' ')
            .trim(),
          titleAr: `ملاحظات: ${item.code ?? ''} ${item.titleAr || item.titleEn}`
            .replace(/\s+/g, ' ')
            .trim(),
          descriptionEn: input.messageEn ?? '',
          descriptionAr: input.messageAr ?? '',
          purpose: 'PROCESS_FEEDBACK',
          definition: PROCESS_FEEDBACK_DEFINITION as unknown as Prisma.InputJsonValue,
          audience: input.audience as unknown as Prisma.InputJsonValue,
          endAt: day(input.endAt),
          processId: input.processId,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'SurveyCampaign',
          entityId: row.id,
          userId: actor.id,
          summary: { feedbackOn: input.processId },
          meta,
        },
        tx,
      );
      return row;
    });
    return this.launch(c.id, actor, meta);
  }

  // ---------- Respondents ----------

  private async ownResponse(id: string, user: AuthUser) {
    const r = await this.prisma.surveyResponse.findUnique({
      where: { id },
      include: { campaign: true },
    });
    if (!r || r.userId !== user.id || r.campaign.deletedAt) throw notFound('Questionnaire');
    return r;
  }

  async myResponse(id: string, user: AuthUser): Promise<MyResponseDto> {
    let r = await this.ownResponse(id, user);
    if (r.status === 'SENT') {
      await this.prisma.surveyResponse.updateMany({
        where: { id, status: 'SENT' },
        data: { status: 'OPENED', openedAt: new Date() },
      });
      r = await this.ownResponse(id, user);
    }
    const c = r.campaign;
    const process = c.processId
      ? await this.prisma.process.findUnique({
          where: { id: c.processId },
          select: { id: true, code: true, nameEn: true, nameAr: true },
        })
      : null;
    return {
      id: r.id,
      campaign: {
        id: c.id,
        titleEn: c.titleEn,
        titleAr: c.titleAr,
        descriptionEn: c.descriptionEn,
        descriptionAr: c.descriptionAr,
        purpose: c.purpose as SurveyPurpose,
        status: c.status as CampaignStatus,
        endAt: iso(c.endAt),
        process,
        definition: c.definition as unknown as QuestionnaireDefinition,
      },
      status: r.status as ResponseProgress,
      answers: (r.answers ?? {}) as Answers,
      files: await this.files.list('SURVEY_RESPONSE', [r.id]),
      submittedAt: iso(r.submittedAt),
      canAnswer: c.status === 'OPEN' && r.status !== 'SUBMITTED',
    };
  }

  /** The (draft) diagram a feedback campaign is about, for its recipients only. */
  async diagram(id: string, user: AuthUser) {
    const r = await this.ownResponse(id, user);
    if (!r.campaign.processId) throw notFound('Diagram');
    const m = await this.prisma.processModel.findUnique({
      where: { processId: r.campaign.processId },
    });
    return { bpmnXml: m?.bpmnXml ?? '' };
  }

  async save(id: string, input: SaveAnswersInput, user: AuthUser, meta: RequestMeta) {
    const r = await this.ownResponse(id, user);
    if (r.campaign.status !== 'OPEN') throw conflict('CAMPAIGN_CLOSED');
    if (r.status === 'SUBMITTED') throw conflict('ALREADY_SUBMITTED');
    const def = r.campaign.definition as unknown as QuestionnaireDefinition;
    const known = new Set(def.sections.flatMap((s) => s.questions.map((q) => q.id)));
    const fileIds = new Set((await this.files.list('SURVEY_RESPONSE', [id])).map((f) => f.id));
    const answers: Answers = {};
    for (const [k, v] of Object.entries(input.answers)) {
      if (!known.has(k)) continue;
      const q = def.sections.flatMap((s) => s.questions).find((x) => x.id === k)!;
      answers[k] = q.type === 'FILE' && Array.isArray(v) ? v.filter((f) => fileIds.has(f)) : v;
    }
    if (input.submit) {
      const problems = answerProblems(def, answers);
      if (problems.length)
        throw badRequest('ANSWERS_INVALID', 'Some answers are missing or invalid', { problems });
    }
    const score = input.submit ? scoreAnswers(def, answers) : null;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.surveyResponse.updateMany({
        where: { id, status: { not: 'SUBMITTED' } },
        data: {
          answers: answers as Prisma.InputJsonValue,
          ...(input.submit
            ? {
                status: 'SUBMITTED',
                submittedAt: now,
                score: score?.score ?? null,
                maxScore: score?.maxScore ?? null,
              }
            : { status: 'OPENED', openedAt: r.openedAt ?? now }),
        },
      });
      if (!res.count) throw conflict('ALREADY_SUBMITTED');
      if (!input.submit) return;
      const proposals = proposalsFromAnswers(def, answers);
      if (proposals.length)
        await tx.surveyProposal.createMany({
          data: proposals.map((p) => ({ ...p, campaignId: r.campaignId, responseId: id })),
        });
      if (r.campaign.purpose === 'PROCESS_FEEDBACK' && r.campaign.processId)
        await this.feedbackComment(tx, r.campaign, def, answers, user);
      await this.audit.log(
        {
          action: 'SUBMIT',
          entityType: 'SurveyResponse',
          entityId: id,
          userId: user.id,
          summary: {
            campaignId: r.campaignId,
            score: score?.percent ?? null,
            proposals: proposals.length,
          },
          meta,
        },
        tx,
      );
    });
    return this.myResponse(id, user);
  }

  /** Feedback answers become a comment on the process (its Comments panel), by the respondent. */
  private async feedbackComment(
    tx: Prisma.TransactionClient,
    c: { titleEn: string; titleAr: string; processId: string | null },
    def: QuestionnaireDefinition,
    answers: Answers,
    user: AuthUser,
  ) {
    const ar = user.locale === 'ar';
    const lines = def.sections
      .flatMap((s) => s.questions)
      .filter(
        (q) =>
          isQuestionVisible(q, answers) &&
          answers[q.id] !== undefined &&
          answers[q.id] !== null &&
          answers[q.id] !== '',
      )
      .map((q) => {
        const a = answers[q.id];
        const text = ar ? q.textAr || q.textEn : q.textEn || q.textAr;
        const value =
          q.type === 'RATING'
            ? `${a}/5`
            : q.type === 'YES_NO_NA'
              ? (
                  {
                    YES: ar ? 'نعم' : 'Yes',
                    NO: ar ? 'لا' : 'No',
                    NA: ar ? 'لا ينطبق' : 'N/A',
                  } as Record<string, string>
                )[String(a)]
              : Array.isArray(a)
                ? a.join(', ')
                : String(a);
        return `${text} ${value}`;
      });
    await tx.comment.create({
      data: {
        entityType: 'PROCESS',
        entityId: c.processId!,
        body: [`${ar ? c.titleAr || c.titleEn : c.titleEn || c.titleAr}`, ...lines].join('\n'),
        createdById: user.id,
      },
    });
  }

  async uploadAnswerFile(
    id: string,
    file: Express.Multer.File | undefined,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const r = await this.ownResponse(id, user);
    if (r.campaign.status !== 'OPEN' || r.status === 'SUBMITTED') throw conflict('CAMPAIGN_CLOSED');
    return this.files.upload('SURVEY_RESPONSE', id, file, user, meta, 'SurveyResponse');
  }

  async myTasks(user: AuthUser) {
    if (!user.permissions.has(PERMISSIONS.SURVEYS_RESPOND)) return { surveys: [] };
    const rows = await this.prisma.surveyResponse.findMany({
      where: {
        userId: user.id,
        status: { not: 'SUBMITTED' },
        campaign: { status: 'OPEN', deletedAt: null },
      },
      include: { campaign: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      surveys: rows.map((r) => ({
        id: r.id,
        status: r.status as ResponseProgress,
        campaign: {
          id: r.campaign.id,
          titleEn: r.campaign.titleEn,
          titleAr: r.campaign.titleAr,
          purpose: r.campaign.purpose as SurveyPurpose,
          endAt: iso(r.campaign.endAt),
        },
      })),
    };
  }

  // ---------- Results, export, proposals ----------

  async results(id: string, user: AuthUser): Promise<CampaignResultsDto> {
    const c = await this.campaignRow(id);
    if (!(await this.mayManageCampaign(c, user))) throw notFound('Campaign');
    const def = c.definition as unknown as QuestionnaireDefinition;
    const responses = await this.prisma.surveyResponse.findMany({ where: { campaignId: id } });
    const submitted = responses.filter((r) => r.status === 'SUBMITTED');
    const [dto] = await this.campaignDtos([c]);
    const scored = submitted.filter((r) => r.maxScore);
    return {
      campaignId: id,
      counts: dto.counts,
      responseRate: dto.responseRate,
      averageScorePercent: scored.length
        ? Math.round(scored.reduce((n, r) => n + (r.score! / r.maxScore!) * 100, 0) / scored.length)
        : null,
      questions: def.sections
        .flatMap((s) => s.questions)
        .map((q) => {
          const values = submitted
            .map((r) => (r.answers as Answers)[q.id])
            .filter(
              (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length),
            );
          const counts: Record<string, number> = {};
          for (const v of values)
            for (const x of Array.isArray(v) ? v : [v])
              counts[String(x)] = (counts[String(x)] ?? 0) + 1;
          const nums = values.filter((v): v is number => typeof v === 'number');
          return {
            questionId: q.id,
            type: q.type,
            answered: values.length,
            counts: ['TEXT', 'NUMBER', 'DATE', 'FILE'].includes(q.type) ? {} : counts,
            average:
              nums.length && (q.type === 'RATING' || q.type === 'NUMBER')
                ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
                : null,
            texts: q.type === 'TEXT' || q.type === 'DATE' ? values.map(String).slice(0, 500) : [],
            files:
              q.type === 'FILE'
                ? values.reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0)
                : 0,
          };
        }),
    };
  }

  async exportExcel(id: string, locale: Locale, user: AuthUser, meta: RequestMeta) {
    const detail = await this.campaign(id, user);
    const rows = await this.prisma.surveyResponse.findMany({ where: { campaignId: id } });
    const ar = locale === 'ar';
    const L = (en: string, a: string) => (ar ? a || en : en || a);
    const questions = detail.definition.sections.flatMap((s) => s.questions);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(ar ? 'الردود' : 'Responses', {
      views: [{ state: 'frozen', ySplit: 1, rightToLeft: ar }],
    });
    ws.addRow([
      ar ? 'المستجيب' : 'Respondent',
      ar ? 'البريد' : 'Email',
      ar ? 'الحالة' : 'Status',
      ar ? 'تاريخ التقديم' : 'Submitted',
      ar ? 'النتيجة %' : 'Score %',
      ...questions.map((q) => L(q.textEn, q.textAr)),
    ]);
    ws.getRow(1).font = { bold: true };
    const status: Record<string, string> = ar
      ? { SENT: 'مرسل', OPENED: 'مفتوح', SUBMITTED: 'مقدَّم' }
      : { SENT: 'Sent', OPENED: 'Opened', SUBMITTED: 'Submitted' };
    for (const resp of detail.responses) {
      const answers = (rows.find((r) => r.id === resp.id)?.answers ?? {}) as Answers;
      ws.addRow([
        L(resp.user.nameEn, resp.user.nameAr),
        resp.user.email,
        status[resp.status],
        resp.submittedAt ? resp.submittedAt.slice(0, 10) : '',
        resp.maxScore ? Math.round(((resp.score ?? 0) / resp.maxScore) * 100) : '',
        ...questions.map((q) => {
          const a = answers[q.id];
          if (a === undefined || a === null) return '';
          if (q.type === 'SINGLE' || q.type === 'MULTIPLE') {
            const chosen = Array.isArray(a) ? a : [String(a)];
            return q.options
              .filter((o) => chosen.includes(o.id))
              .map((o) => L(o.en, o.ar))
              .join(', ');
          }
          if (q.type === 'FILE') return Array.isArray(a) ? a.length : 0;
          return Array.isArray(a) ? a.join(', ') : a;
        }),
      ]);
    }
    ws.columns.forEach((col, i) => (col.width = i < 2 ? 26 : i < 5 ? 14 : 30));
    const results = await this.results(id, user);
    const sum = wb.addWorksheet(ar ? 'الملخص' : 'Summary', { views: [{ rightToLeft: ar }] });
    sum.addRow([L(detail.titleEn, detail.titleAr)]).font = { bold: true, size: 14 };
    sum.addRow([ar ? 'نسبة الاستجابة %' : 'Response rate %', results.responseRate]);
    sum.addRow([ar ? 'متوسط النتيجة %' : 'Average score %', results.averageScorePercent ?? '']);
    sum.addRow([]);
    for (const q of questions) {
      const r = results.questions.find((x) => x.questionId === q.id)!;
      sum.addRow([
        L(q.textEn, q.textAr),
        `${ar ? 'إجابات' : 'Answers'}: ${r.answered}`,
        r.average !== null ? `${ar ? 'المتوسط' : 'Average'}: ${r.average}` : '',
      ]).font = { bold: true };
      for (const [k, n] of Object.entries(r.counts)) {
        const opt = q.options.find((o) => o.id === k);
        sum.addRow(['', opt ? L(opt.en, opt.ar) : k, n]);
      }
    }
    sum.getColumn(1).width = 50;
    sum.getColumn(2).width = 30;
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'SurveyCampaign',
      entityId: id,
      userId: user.id,
      summary: { report: 'survey-results', locale },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: `survey-results-${locale}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  async proposals(campaignId: string, user: AuthUser): Promise<SurveyProposalDto[]> {
    const c = await this.campaignRow(campaignId);
    if (!(await this.mayManageCampaign(c, user)) && !user.permissions.has(PERMISSIONS.GRC_EDIT))
      throw notFound('Campaign');
    const rows = await this.prisma.surveyProposal.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    });
    const [objects, responses] = await Promise.all([
      this.prisma.repoObject.findMany({
        where: { id: { in: rows.map((r) => r.objectId) } },
        include: { risk: true, control: true },
      }),
      this.prisma.surveyResponse.findMany({
        where: { id: { in: rows.map((r) => r.responseId) } },
        select: { id: true, userId: true },
      }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: responses.map((r) => r.userId) } },
      select: userSelect,
    });
    return rows
      .map((p): SurveyProposalDto | null => {
        const o = objects.find((x) => x.id === p.objectId);
        if (!o) return null;
        const current =
          p.field === 'EFFECTIVENESS'
            ? (o.control?.effectiveness ?? null)
            : p.field === 'LIKELIHOOD'
              ? String(o.risk?.residualLikelihood ?? o.risk?.inherentLikelihood ?? '')
              : String(o.risk?.residualImpact ?? o.risk?.inherentImpact ?? '');
        const uid = responses.find((r) => r.id === p.responseId)?.userId;
        return {
          id: p.id,
          questionId: p.questionId,
          object: {
            id: o.id,
            type: o.type as GrcObjectType,
            code: o.code,
            nameEn: o.nameEn,
            nameAr: o.nameAr,
            status: o.risk?.status ?? o.control?.status ?? 'ACTIVE',
          },
          field: p.field as ProposalField,
          value: p.value,
          current: current || null,
          status: p.status as SurveyProposalDto['status'],
          respondent: users.find((u) => u.id === uid) ?? null,
          createdAt: p.createdAt.toISOString(),
        };
      })
      .filter((v): v is SurveyProposalDto => !!v);
  }

  /** A Risk & Compliance officer accepts (applies through the normal update, incl. approval) or dismisses. */
  async decideProposal(
    id: string,
    input: ProposalDecisionInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const p = await this.prisma.surveyProposal.findUnique({
      where: { id },
      include: { campaign: true },
    });
    if (!p) throw notFound('Proposal');
    if (!actor.permissions.has(PERMISSIONS.GRC_EDIT)) throw forbidden();
    if (p.status !== 'PENDING') throw conflict('PROPOSAL_DECIDED');
    if (input.decision === 'ACCEPT') {
      const comment = `${p.campaign.titleEn || p.campaign.titleAr} (${p.questionId})`;
      if (p.field === 'EFFECTIVENESS') {
        await this.grc.updateControl(
          p.objectId,
          { effectiveness: p.value as 'EFFECTIVE', comment },
          actor,
          meta,
        );
      } else {
        const r = await this.prisma.risk.findUniqueOrThrow({ where: { objectId: p.objectId } });
        const v = Number(p.value);
        const likelihood =
          p.field === 'LIKELIHOOD' ? v : (r.residualLikelihood ?? r.inherentLikelihood);
        const impact = p.field === 'IMPACT' ? v : (r.residualImpact ?? r.inherentImpact);
        await this.grc.updateRisk(
          p.objectId,
          { residualLikelihood: likelihood, residualImpact: impact, comment },
          actor,
          meta,
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.surveyProposal.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DISMISSED',
          decidedById: actor.id,
          decidedAt: new Date(),
        },
      });
      if (!res.count) throw conflict('PROPOSAL_DECIDED');
      await this.audit.log(
        {
          action: input.decision === 'ACCEPT' ? 'APPROVE' : 'REJECT',
          entityType: 'SurveyCampaign',
          entityId: p.campaignId,
          userId: actor.id,
          summary: { proposal: id, objectId: p.objectId, field: p.field, value: p.value },
          meta,
        },
        tx,
      );
    });
    return this.proposals(p.campaignId, actor);
  }

  // ---------- Scheduler ----------

  async runScheduler(now: Date) {
    let sent = 0;
    const open = await this.prisma.surveyCampaign.findMany({
      where: { status: 'OPEN', deletedAt: null, endAt: { not: null } },
    });
    for (const c of open) {
      if (c.endAt! < new Date(now.getTime() - DAY + 1)) {
        await this.close(c.id, null);
        continue;
      }
      if (c.endAt!.getTime() - c.reminderDaysBefore * DAY > now.getTime()) continue;
      const pending = await this.prisma.surveyResponse.findMany({
        where: { campaignId: c.id, status: { not: 'SUBMITTED' }, reminderSentAt: null },
      });
      for (const r of pending) {
        sent += await this.notify(c, r, 'reminder', null, `SURVEY:reminder:${r.id}`);
        await this.prisma.surveyResponse.update({
          where: { id: r.id },
          data: { reminderSentAt: now },
        });
      }
    }
    return sent;
  }
}
