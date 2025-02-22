/**
 * Package @commodo/fields does not have types.
 */
// @ts-ignore
import { withFields, string } from "@commodo/fields";
import { validation } from "@webiny/validation";
/**
 * Package mdbid does not have types.
 */
// @ts-ignore
import mdbid from "mdbid";
import {
    CmsGroupContext,
    CmsGroupListParams,
    CmsGroupPermission,
    CmsGroup,
    CmsContext,
    HeadlessCmsStorageOperations,
    CmsGroupCreateInput,
    OnGroupBeforeCreateTopicParams,
    OnGroupAfterCreateTopicParams,
    OnGroupBeforeUpdateTopicParams,
    OnGroupAfterUpdateTopicParams,
    OnGroupBeforeDeleteTopicParams,
    OnGroupAfterDeleteTopicParams,
    OnGroupCreateErrorTopicParams,
    OnGroupUpdateErrorTopicParams,
    OnGroupDeleteErrorTopicParams
} from "~/types";
import { NotFoundError } from "@webiny/handler-graphql";
import WebinyError from "@webiny/error";
import { CmsGroupPlugin } from "~/plugins/CmsGroupPlugin";
import { Tenant } from "@webiny/api-tenancy/types";
import { I18NLocale } from "@webiny/api-i18n/types";
import { SecurityIdentity } from "@webiny/api-security/types";
import { createTopic } from "@webiny/pubsub";
import { assignBeforeGroupUpdate } from "./contentModelGroup/beforeUpdate";
import { assignBeforeGroupCreate } from "./contentModelGroup/beforeCreate";
import { assignBeforeGroupDelete } from "./contentModelGroup/beforeDelete";
import DataLoader from "dataloader";
import { checkPermissions as baseCheckPermissions } from "~/utils/permissions";
import { checkOwnership, validateOwnership } from "~/utils/ownership";
import { validateGroupAccess } from "~/utils/access";
import { toSlug } from "~/utils/toSlug";

const CreateContentModelGroupModel = withFields({
    name: string({ validation: validation.create("required,maxLength:100") }),
    slug: string({ validation: validation.create("maxLength:100") }),
    description: string({ validation: validation.create("maxLength:255") }),
    icon: string({ validation: validation.create("required,maxLength:255") })
})();

const UpdateContentModelGroupModel = withFields({
    name: string({ validation: validation.create("maxLength:100") }),
    description: string({ validation: validation.create("maxLength:255") }),
    icon: string({ validation: validation.create("maxLength:255") })
})();

export interface CreateModelGroupsCrudParams {
    getTenant: () => Tenant;
    getLocale: () => I18NLocale;
    storageOperations: HeadlessCmsStorageOperations;
    context: CmsContext;
    getIdentity: () => SecurityIdentity;
}
export const createModelGroupsCrud = (params: CreateModelGroupsCrudParams): CmsGroupContext => {
    const { getTenant, getIdentity, getLocale, storageOperations, context } = params;

    const dataLoaders = {
        listGroups: new DataLoader(async () => {
            const tenant = getTenant().id;
            const locale = getLocale().code;

            const pluginsGroups = getGroupsAsPlugins().map(group => {
                return {
                    ...group,
                    tenant: group.tenant || tenant,
                    locale: group.locale || locale
                };
            });

            const groups = await storageOperations.groups.list({
                where: {
                    tenant: getTenant().id,
                    locale: getLocale().code
                }
            });

            return [groups.concat(pluginsGroups)];
        })
    };

    const clearGroupsCache = (): void => {
        for (const loader of Object.values(dataLoaders)) {
            loader.clearAll();
        }
    };

    const getGroupsAsPlugins = (): CmsGroup[] => {
        const tenant = getTenant().id;
        const locale = getLocale().code;

        return (
            context.plugins
                .byType<CmsGroupPlugin>(CmsGroupPlugin.type)
                /**
                 * We need to filter out groups that are not for this tenant or locale.
                 * If it does not have tenant or locale define, it is for every locale and tenant
                 */
                .filter(plugin => {
                    const { tenant: t, locale: l } = plugin.contentModelGroup;
                    if (t && t !== tenant) {
                        return false;
                    } else if (l && l !== locale) {
                        return false;
                    }
                    return true;
                })
                .map(plugin => {
                    return {
                        ...plugin.contentModelGroup,
                        tenant,
                        locale,
                        webinyVersion: context.WEBINY_VERSION
                    };
                })
        );
    };

    const checkPermissions = (check: string): Promise<CmsGroupPermission> => {
        return baseCheckPermissions(context, "cms.contentModelGroup", { rwd: check });
    };

    const groupsGet = async (id: string) => {
        const groups = await dataLoaders.listGroups.load("listGroups");

        const group = groups.find(g => g.id === id);

        if (!group) {
            throw new NotFoundError(`Cms Group "${id}" was not found!`);
        }
        return group;
    };

    const groupsList = async (params: CmsGroupListParams) => {
        const { where } = params || {};

        try {
            return await dataLoaders.listGroups.load("listGroups");
        } catch (ex) {
            throw new WebinyError(ex.message, ex.code || "LIST_ERROR", {
                ...(ex.data || {}),
                where
            });
        }
    };

    /**
     * Create
     */
    const onGroupBeforeCreate =
        createTopic<OnGroupBeforeCreateTopicParams>("cms.onGroupBeforeCreate");
    const onGroupAfterCreate = createTopic<OnGroupAfterCreateTopicParams>("cms.onGroupAfterCreate");
    const onGroupCreateError = createTopic<OnGroupCreateErrorTopicParams>("cms.onGroupCreateError");
    /**
     * Update
     */
    const onGroupBeforeUpdate =
        createTopic<OnGroupBeforeUpdateTopicParams>("cms.onGroupBeforeUpdate");
    const onGroupAfterUpdate = createTopic<OnGroupAfterUpdateTopicParams>("cms.onGroupAfterUpdate");
    const onGroupUpdateError = createTopic<OnGroupUpdateErrorTopicParams>("cms.onGroupUpdateError");
    /**
     * Delete
     */
    const onGroupBeforeDelete =
        createTopic<OnGroupBeforeDeleteTopicParams>("cms.onGroupBeforeDelete");
    const onGroupAfterDelete = createTopic<OnGroupAfterDeleteTopicParams>("cms.onGroupAfterDelete");
    const onGroupDeleteError = createTopic<OnGroupDeleteErrorTopicParams>("cms.onGroupDeleteError");

    /**
     * We need to assign some default behaviors.
     */
    assignBeforeGroupCreate({
        onGroupBeforeCreate,
        plugins: context.plugins,
        storageOperations
    });
    assignBeforeGroupUpdate({
        onGroupBeforeUpdate,
        plugins: context.plugins
    });
    assignBeforeGroupDelete({
        onGroupBeforeDelete,
        plugins: context.plugins,
        storageOperations
    });

    return {
        /**
         * Deprecated - will be removed in 5.36.0
         */
        onBeforeGroupCreate: onGroupBeforeCreate,
        onAfterGroupCreate: onGroupAfterCreate,
        onBeforeGroupUpdate: onGroupBeforeUpdate,
        onAfterGroupUpdate: onGroupAfterUpdate,
        onBeforeGroupDelete: onGroupBeforeDelete,
        onAfterGroupDelete: onGroupAfterDelete,
        /**
         * Released in 5.34.0
         */
        onGroupBeforeCreate,
        onGroupAfterCreate,
        onGroupCreateError,
        onGroupBeforeUpdate,
        onGroupAfterUpdate,
        onGroupUpdateError,
        onGroupBeforeDelete,
        onGroupAfterDelete,
        onGroupDeleteError,
        clearGroupsCache,
        getGroup: async id => {
            const permission = await checkPermissions("r");

            const group = await groupsGet(id);
            checkOwnership(context, permission, group);
            validateGroupAccess(context, permission, group);

            return group;
        },
        listGroups: async params => {
            const { where } = params || {};

            const { tenant, locale } = where || {};
            const permission = await checkPermissions("r");

            const response = await groupsList({
                ...(params || {}),
                where: {
                    ...(where || {}),
                    tenant: tenant || getTenant().id,
                    locale: locale || getLocale().code
                }
            });

            return response.filter(group => {
                if (!validateOwnership(context, permission, group)) {
                    return false;
                }
                return validateGroupAccess(context, permission, group);
            });
        },
        createGroup: async inputData => {
            await checkPermissions("w");

            const createdData = new CreateContentModelGroupModel().populate({
                ...inputData,
                slug: inputData.slug ? toSlug(inputData.slug) : "",
                description: inputData.description || ""
            });
            await createdData.validate();
            const input: CmsGroupCreateInput & { slug: string; description: string } =
                await createdData.toJSON();

            const identity = getIdentity();

            const id = mdbid();
            const group: CmsGroup = {
                ...input,
                id,
                tenant: getTenant().id,
                locale: getLocale().code,
                createdOn: new Date().toISOString(),
                savedOn: new Date().toISOString(),
                createdBy: {
                    id: identity.id,
                    displayName: identity.displayName,
                    type: identity.type
                },
                webinyVersion: context.WEBINY_VERSION
            };
            try {
                await onGroupBeforeCreate.publish({
                    group
                });

                const result = await storageOperations.groups.create({
                    group
                });

                clearGroupsCache();

                await onGroupAfterCreate.publish({
                    group: result
                });

                return group;
            } catch (ex) {
                await onGroupCreateError.publish({
                    input,
                    group,
                    error: ex
                });
                throw new WebinyError(
                    ex.message || "Could not save data model group.",
                    ex.code || "ERROR_ON_CREATE",
                    {
                        ...(ex.data || {}),
                        group,
                        input
                    }
                );
            }
        },
        updateGroup: async (id, inputData) => {
            const permission = await checkPermissions("w");

            const original = await groupsGet(id);

            checkOwnership(context, permission, original);

            const input = new UpdateContentModelGroupModel().populate(inputData);
            await input.validate();

            const updatedDataJson: Partial<CmsGroup> = await input.toJSON({
                onlyDirty: true
            });

            /**
             * No need to continue if no values were changed
             */
            if (Object.keys(updatedDataJson).length === 0) {
                return original;
            }

            const group: CmsGroup = {
                ...original,
                ...updatedDataJson,
                locale: getLocale().code,
                tenant: getTenant().id,
                savedOn: new Date().toISOString()
            };

            try {
                await onGroupBeforeUpdate.publish({
                    original,
                    group
                });

                const updatedGroup = await storageOperations.groups.update({
                    group
                });
                clearGroupsCache();

                await onGroupAfterUpdate.publish({
                    original,
                    group: updatedGroup
                });

                return updatedGroup;
            } catch (ex) {
                await onGroupUpdateError.publish({
                    input,
                    original,
                    group,
                    error: ex
                });
                throw new WebinyError(ex.message, ex.code || "UPDATE_ERROR", {
                    error: ex,
                    original,
                    group,
                    input
                });
            }
        },
        deleteGroup: async id => {
            const permission = await checkPermissions("d");

            const group = await groupsGet(id);

            checkOwnership(context, permission, group);

            try {
                await onGroupBeforeDelete.publish({
                    group
                });

                await storageOperations.groups.delete({ group });
                clearGroupsCache();

                await onGroupAfterDelete.publish({
                    group
                });
            } catch (ex) {
                await onGroupDeleteError.publish({
                    group,
                    error: ex
                });
                throw new WebinyError(ex.message, ex.code || "DELETE_ERROR", {
                    ...(ex.data || {}),
                    id
                });
            }

            return true;
        }
    };
};
