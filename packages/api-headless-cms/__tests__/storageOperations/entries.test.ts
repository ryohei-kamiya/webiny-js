import {
    createPersonEntries,
    createPersonModel,
    deletePersonModel,
    PersonEntriesResult
} from "./helpers";
import { StorageOperationsCmsModel, HeadlessCmsStorageOperations } from "~/types";
import { useGraphQLHandler } from "../testHelpers/useGraphQLHandler";

jest.setTimeout(60000);

interface WaitPersonRecordsParams {
    records: PersonEntriesResult;
    storageOperations: HeadlessCmsStorageOperations;
    name: string;
    until: Function;
    model: StorageOperationsCmsModel;
}
const waitPersonRecords = async (params: WaitPersonRecordsParams): Promise<void> => {
    const { records, storageOperations, until, model, name } = params;
    await until(
        () => {
            return storageOperations.entries.list(model, {
                where: {
                    latest: true
                },
                sort: ["version_ASC"],
                limit: 10000
            });
        },
        ({ items }: any) => {
            /**
             * There must be item for each result last revision id.
             */
            return Object.values(records).every(record => {
                return items.some((item: any) => item.id === record.last.id);
            });
        },
        {
            name
        }
    );
};

describe("Entries storage operations", () => {
    const { storageOperations, until, plugins } = useGraphQLHandler({
        path: "manage/en-US"
    });

    /**
     * We must load CMS GraphQL field plugins for the storage operations to work.
     * This is specifically for DDB and DDB+ES storage operations.
     * Some others might not need them...
     */
    beforeAll(async () => {
        if (!storageOperations.beforeInit) {
            return;
        }
        await storageOperations.beforeInit({
            plugins
        } as any);
    });

    beforeEach(async () => {
        await deletePersonModel({
            storageOperations,
            plugins
        });
    });

    afterEach(async () => {
        await deletePersonModel({
            storageOperations,
            plugins
        });
    });

    it("getRevisions - should get revisions of all the entries", async () => {
        const personModel = createPersonModel(plugins);
        const amount = 102;
        const results = await createPersonEntries({
            amount,
            storageOperations,
            maxRevisions: 3,
            plugins
        });
        /**
         * We run a check that results have last entry as the amount of revisions.
         */
        for (const entryId in results) {
            const result = results[entryId];

            expect(result.last.version).toEqual(result.revisions.length);
        }

        await waitPersonRecords({
            records: results,
            storageOperations,
            name: "list all person entries after create",
            until,
            model: personModel
        });

        /**
         * There must be "amount" of results.
         */
        expect(Object.values(results)).toHaveLength(amount);

        for (const entryId in results) {
            const first = results[entryId].first;
            const revisions = results[entryId].revisions;

            const revisionIdList: string[] = [];
            /**
             * We fetch revisions of each first entry.
             */
            const resultRevisions = await storageOperations.entries.getRevisions(personModel, {
                id: first.id
            });
            /**
             * We must have exact amount of revisions as created.
             */
            expect(resultRevisions).toHaveLength(revisions.length);

            for (const rev of revisions) {
                const res = resultRevisions.filter(r => r.id === rev.id);
                /**
                 * Each revision must be loaded only once.
                 */
                expect(res).toHaveLength(1);
                /**
                 * And we cannot have same IDs in the revisions.
                 */
                expect(revisionIdList).not.toContain(rev.id);

                revisionIdList.push(rev.id);
            }
        }
    });

    it("should list all entries", async () => {
        const personModel = createPersonModel(plugins);
        const amount = 10;
        const results = await createPersonEntries({
            amount,
            storageOperations,
            maxRevisions: 1,
            plugins
        });
        await waitPersonRecords({
            records: results,
            storageOperations,
            name: "list all person entries after create",
            until,
            model: personModel
        });

        const result = await storageOperations.entries.list(personModel, {
            where: {
                name_contains: "person ",
                latest: true
            },
            limit: 1000
        });

        expect(result.items).toHaveLength(amount);
        expect(result).toMatchObject({
            cursor: null,
            hasMoreItems: false,
            totalCount: amount
        });
    });

    it("getByIds - should get all entries by id list", async () => {
        const personModel = createPersonModel(plugins);
        const amount = 202;
        const results = await createPersonEntries({
            amount,
            storageOperations,
            maxRevisions: 1,
            plugins
        });

        await waitPersonRecords({
            records: results,
            storageOperations,
            name: "list all person entries after create",
            until,
            model: personModel
        });

        const items = Object.values(results);

        const records = await storageOperations.entries.getByIds(personModel, {
            ids: items.map(result => result.last.id)
        });

        expect(records).toHaveLength(items.length);
    });
});
