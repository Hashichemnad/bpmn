# Salesforce fixtures (tests only)

Recorded-style responses of the Salesforce REST API for the KPI link tests (`salesforce.e2e-spec.ts`): OAuth token,
SOQL query results of the PMS KPI objects (`Org_Kpi_Goal__c`, `Org_Kpi_Measure__c`, `Org_Kpi_Process__c` — paged with `nextRecordsUrl`, one result not approved) and a
describe result. **All ids, names, values and tokens are invented** — no real credentials or organisation data. The
test transport (`FakeSalesforce` in `../../helpers.ts`) serves these files; the test suite never calls Salesforce.
