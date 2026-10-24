// The one conversion between the timeline's clock (days, from each patient's anchor date) and the
// clinical survival columns (<X>_MONTHS): a month is 30.4375 days, a year of 365.25 over twelve, as
// cBioPortal's own timeline converts it. Every SQL statement and every caption that changes unit reads
// it from here, so no two places can disagree about it. Browser-safe.

/** days in a month, on every clock this app converts between */
export const DAYS_PER_MONTH = 30.4375;
