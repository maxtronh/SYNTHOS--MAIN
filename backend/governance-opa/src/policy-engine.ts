export type OperatorRole =
  | 'DEVELOPER'
  | 'SENIOR_ENGINEER'
  | 'SECURITY_LEAD'
  | 'RELEASE_DIRECTOR';

export type GovernanceAction =
  | 'SUBMIT_BLUEPRINT'
  | 'APPROVE_BLUEPRINT'
  | 'OVERRIDE_CRITICAL_THREAT'
  | 'RESOLVE_DECISION_MEMO'
  | 'PROMOTE_PRODUCTION';

export interface OperatorPrincipal {
  subjectId: string;
  email: string;
  tenantId: string;
  roles: OperatorRole[];
  ssoAuthenticated: boolean;
}

export interface PolicyEvaluationContext {
  principal: OperatorPrincipal;
  action: GovernanceAction;
  resourceTenantId: string;
  resourceAuthorId?: string | undefined;
}

export interface PolicyDecision {
  allowed: boolean;
  reasons: string[];
}

const REQUIRED_ROLES: Record<GovernanceAction, ReadonlySet<OperatorRole>> = {
  SUBMIT_BLUEPRINT: new Set(['DEVELOPER', 'SENIOR_ENGINEER', 'RELEASE_DIRECTOR']),
  APPROVE_BLUEPRINT: new Set(['SENIOR_ENGINEER', 'RELEASE_DIRECTOR']),
  OVERRIDE_CRITICAL_THREAT: new Set(['SECURITY_LEAD']),
  RESOLVE_DECISION_MEMO: new Set(['SENIOR_ENGINEER', 'SECURITY_LEAD', 'RELEASE_DIRECTOR']),
  PROMOTE_PRODUCTION: new Set(['RELEASE_DIRECTOR']),
};

/**
 * Phase 26: Multi-Tenant RBAC, SSO & Policy-as-Code Evaluator (OPA/Rego semantics).
 * Enforces SSO authentication, strict tenant isolation, role authorization, and separation of duties.
 */
export class OpaPolicyEvaluator {
  public static evaluate(ctx: PolicyEvaluationContext): PolicyDecision {
    const reasons: string[] = [];

    if (!ctx.principal.ssoAuthenticated) {
      reasons.push('SSO Authentication Required: Unauthenticated principals cannot execute control plane actions.');
    }

    if (ctx.principal.tenantId !== ctx.resourceTenantId) {
      reasons.push(
        `Tenant Isolation Violation: Principal tenant '${ctx.principal.tenantId}' cannot access resource in tenant '${ctx.resourceTenantId}'.`
      );
    }

    const allowedRoles = REQUIRED_ROLES[ctx.action];
    const hasRequiredRole = ctx.principal.roles.some(role => allowedRoles.has(role));
    if (!hasRequiredRole) {
      reasons.push(
        `RBAC Denied: Action '${ctx.action}' requires one of [${Array.from(allowedRoles).join(', ')}].`
      );
    }

    // Separation of Duties (SoD): Authors cannot self-promote their own code to production
    if (
      ctx.action === 'PROMOTE_PRODUCTION' &&
      ctx.resourceAuthorId !== undefined &&
      ctx.principal.subjectId === ctx.resourceAuthorId
    ) {
      reasons.push(
        `Separation of Duties Violation: Author '${ctx.principal.subjectId}' cannot self-approve production promotion.`
      );
    }

    return {
      allowed: reasons.length === 0,
      reasons,
    };
  }
}
