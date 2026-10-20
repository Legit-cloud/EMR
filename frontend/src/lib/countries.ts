/**
 * Countries for the phone prefix and address selectors. A short list for the markets we
 * expect (Nigeria first, then West and East Africa, then the usual diaspora); anything else
 * can be typed as a full number starting with "+".
 */
export type Country = { iso: string; name: string; dial: string };

export const DEFAULT_COUNTRY = "NG";

export const COUNTRIES: Country[] = [
  { iso: "NG", name: "Nigeria", dial: "234" },
  { iso: "GH", name: "Ghana", dial: "233" },
  { iso: "BJ", name: "Benin", dial: "229" },
  { iso: "CM", name: "Cameroon", dial: "237" },
  { iso: "TD", name: "Chad", dial: "235" },
  { iso: "CI", name: "Côte d'Ivoire", dial: "225" },
  { iso: "KE", name: "Kenya", dial: "254" },
  { iso: "NE", name: "Niger", dial: "227" },
  { iso: "SN", name: "Senegal", dial: "221" },
  { iso: "ZA", name: "South Africa", dial: "27" },
  { iso: "GB", name: "United Kingdom", dial: "44" },
  { iso: "US", name: "United States", dial: "1" },
];

export function countryByIso(iso: string): Country {
  return COUNTRIES.find((c) => c.iso === iso) ?? COUNTRIES[0];
}
