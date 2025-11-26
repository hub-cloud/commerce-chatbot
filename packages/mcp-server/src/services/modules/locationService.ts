import { withRetry } from '../../utils/retryUtils.js';
import { SapCommerceClient } from './sapCommerceClient.js';

export interface Country {
    isocode: string;
    name: string;
}

export interface Region {
    isocode: string;
    name: string;
    countryIso: string;
}

export class LocationService {
    private client: SapCommerceClient;

    constructor(client: SapCommerceClient) {
        this.client = client;
    }

    async getCountries(): Promise<Country[]> {
        return withRetry(async () => {
            const response = await this.client.getAxiosClient().get('/countries');
            return response.data.countries || [];
        }, this.client.getRetryConfig());
    }

    async getCountryByIsocode(isocode: string): Promise<Country | null> {
        const countries = await this.getCountries();
        return countries.find(country => country.isocode === isocode) || null;
    }

    async getRegions(countryIsocode: string): Promise<Region[]> {
        return withRetry(async () => {
            const response = await this.client.getAxiosClient().get(`/countries/${countryIsocode}/regions`);
            const regions = response.data.regions || [];
            // Ensure each region has the countryIso field
            return regions.map((region: any) => ({
                ...region,
                countryIso: countryIsocode
            }));
        }, this.client.getRetryConfig());
    }

    async getRegionByIsocode(countryIsocode: string, regionIsocode: string): Promise<Region | null> {
        const regions = await this.getRegions(countryIsocode);
        return regions.find(region => region.isocode === regionIsocode) || null;
    }

    async getRegionByName(countryIsocode: string, regionName: string): Promise<Region | null> {
        const regions = await this.getRegions(countryIsocode);
        const normalizedName = regionName.trim().toLowerCase();
        return regions.find(region =>
            region.name.toLowerCase() === normalizedName
        ) || null;
    }
}
