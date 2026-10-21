import { domainAllowed, identityFromClaims, mapGroups, safeReturnTo } from './sso-claims';

describe('identityFromClaims', () => {
  it('uses the email claim and the name', () => {
    expect(
      identityFromClaims(
        { sub: 's1', email: 'Ana@Example.com', name: 'Ana Ali', groups: ['g1', 'g2'] },
        'OIDC',
        'groups',
      ),
    ).toEqual({
      subject: 's1',
      email: 'ana@example.com',
      emailUnverified: false,
      name: 'Ana Ali',
      groups: ['g1', 'g2'],
      groupsOverage: false,
    });
  });

  it('falls back to preferred_username / upn for Entra ID only', () => {
    const claims = { sub: 's', preferred_username: 'omar@contoso.com' };
    expect(identityFromClaims(claims, 'ENTRA', 'groups').email).toBe('omar@contoso.com');
    expect(identityFromClaims(claims, 'OIDC', 'groups').email).toBeNull();
    expect(identityFromClaims({ sub: 's', upn: 'x@c.com' }, 'ENTRA', 'groups').email).toBe(
      'x@c.com',
    );
    expect(
      identityFromClaims({ sub: 's', preferred_username: 'omar' }, 'ENTRA', 'groups').email,
    ).toBeNull();
  });

  it('flags unverified addresses and Entra ID group overage', () => {
    const id = identityFromClaims(
      { sub: 's', email: 'a@b.co', email_verified: false, _claim_names: { groups: 'src1' } },
      'ENTRA',
      'groups',
    );
    expect(id.emailUnverified).toBe(true);
    expect(id.groupsOverage).toBe(true);
    expect(id.groups).toEqual([]);
  });

  it('reads a custom groups claim and builds a name from given/family name', () => {
    const id = identityFromClaims(
      { sub: 's', email: 'a@b.co', given_name: 'Sara', family_name: 'K', roles: 'Editors' },
      'OIDC',
      'roles',
    );
    expect(id.name).toBe('Sara K');
    expect(id.groups).toEqual(['Editors']);
  });
});

describe('domainAllowed', () => {
  it('matches the exact domain only', () => {
    expect(domainAllowed('a@example.com', ['example.com'])).toBe(true);
    expect(domainAllowed('a@evil-example.com', ['example.com'])).toBe(false);
    expect(domainAllowed('a@sub.example.com', ['example.com'])).toBe(false);
  });
});

describe('mapGroups', () => {
  const mappings = [
    { group: 'G-Editors', roles: ['MODELER' as const], departmentId: null },
    { group: 'g-finance', roles: ['REVIEWER' as const], departmentId: 'dep-1' },
    {
      group: 'g-owners',
      roles: ['PROCESS_OWNER' as const, 'MODELER' as const],
      departmentId: 'dep-2',
    },
  ];
  it('combines the roles of all matching groups (case-insensitive)', () => {
    expect(mapGroups(['g-editors', 'G-FINANCE', 'g-owners'], mappings)).toEqual({
      matched: true,
      roles: ['MODELER', 'REVIEWER', 'PROCESS_OWNER'],
      departmentId: 'dep-1',
    });
  });
  it('reports no match', () => {
    expect(mapGroups(['other'], mappings)).toEqual({
      matched: false,
      roles: [],
      departmentId: null,
    });
  });
});

describe('safeReturnTo', () => {
  it('keeps in-app paths and refuses everything else', () => {
    expect(safeReturnTo('/processes/1?x=2')).toBe('/processes/1?x=2');
    for (const bad of [
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      'evil',
      '/api/v1/x',
      '/login',
      5,
    ]) {
      expect(safeReturnTo(bad)).toBe('/');
    }
  });
});
