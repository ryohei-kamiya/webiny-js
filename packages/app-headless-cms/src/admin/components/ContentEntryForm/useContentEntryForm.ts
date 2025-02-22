import { Dispatch, SetStateAction, useCallback, useMemo, useState, useEffect } from "react";
import pick from "lodash/pick";
import { useRouter } from "@webiny/react-router";
import { useSnackbar } from "@webiny/app-admin/hooks/useSnackbar";
import { FormOnSubmit } from "@webiny/form";
import {
    createCreateFromMutation,
    createCreateMutation,
    createUpdateMutation,
    CmsEntryCreateMutationResponse,
    CmsEntryCreateMutationVariables,
    CmsEntryUpdateMutationResponse,
    CmsEntryUpdateMutationVariables,
    CmsEntryCreateFromMutationResponse,
    CmsEntryCreateFromMutationVariables
} from "~/admin/graphql/contentEntries";
import { useApolloClient, useCms, useModel, useMutation } from "~/admin/hooks";
import * as GQLCache from "~/admin/views/contentEntries/ContentEntry/cache";
import { prepareFormData } from "~/admin/views/contentEntries/ContentEntry/prepareFormData";
import { CmsEditorContentEntry, CmsModelField, CmsEditorFieldRendererPlugin } from "~/types";
import { useContentEntry } from "~/admin/views/contentEntries/hooks/useContentEntry";
import { plugins } from "@webiny/plugins";
import { getFetchPolicy } from "~/utils/getFetchPolicy";

/**
 * Used for some fields to convert their values.
 */
const convertDefaultValue = (field: CmsModelField, value: any): string | number | boolean => {
    switch (field.type) {
        case "boolean":
            return Boolean(value);
        case "number":
            return Number(value);
        default:
            return value;
    }
};

interface InvalidFieldError {
    fieldId: string;
    error: string;
}

interface UseContentEntryForm {
    data: Record<string, any>;
    loading: boolean;
    setLoading: Dispatch<SetStateAction<boolean>>;
    onChange: FormOnSubmit;
    onSubmit: FormOnSubmit;
    invalidFields: Record<string, string>;
    renderPlugins: CmsEditorFieldRendererPlugin[];
}

export interface UseContentEntryFormParams {
    entry: Partial<CmsEditorContentEntry>;
    onChange?: FormOnSubmit;
    onSubmit?: FormOnSubmit;
    addEntryToListCache: boolean;
}

function useEntry(entryFromProps: Partial<CmsEditorContentEntry>) {
    // We need to keep track of the entry locally
    const [entry, setEntry] = useState(entryFromProps);
    const { onEntryRevisionPublish } = useCms();

    useEffect(() => {
        setEntry(entryFromProps);

        if (!entryFromProps.id) {
            return;
        }

        return onEntryRevisionPublish(next => async params => {
            const publishRes = await next(params);
            setEntry(entry => {
                return { ...entry, meta: publishRes?.entry?.meta || {} };
            });
            return publishRes;
        });
    }, [entryFromProps, entry.id]);

    return entry;
}

export function useContentEntryForm(params: UseContentEntryFormParams): UseContentEntryForm {
    const { listQueryVariables } = useContentEntry();
    const { model } = useModel();
    const { history } = useRouter();
    const client = useApolloClient();
    const { showSnackbar } = useSnackbar();
    const [invalidFields, setInvalidFields] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const entry = useEntry(params.entry);

    const renderPlugins = useMemo(
        () => plugins.byType<CmsEditorFieldRendererPlugin>("cms-editor-field-renderer"),
        []
    );

    const goToRevision = useCallback(id => {
        history.push(`/cms/content-entries/${model.modelId}?id=${encodeURIComponent(id)}`);
    }, []);

    const { CREATE_CONTENT, UPDATE_CONTENT, CREATE_CONTENT_FROM } = useMemo(() => {
        return {
            // LIST_CONTENT: createListQuery(model),
            CREATE_CONTENT: createCreateMutation(model),
            UPDATE_CONTENT: createUpdateMutation(model),
            CREATE_CONTENT_FROM: createCreateFromMutation(model)
        };
    }, [model.modelId]);

    const [createMutation] = useMutation<
        CmsEntryCreateMutationResponse,
        CmsEntryCreateMutationVariables
    >(CREATE_CONTENT);
    const [updateMutation] = useMutation<
        CmsEntryUpdateMutationResponse,
        CmsEntryUpdateMutationVariables
    >(UPDATE_CONTENT);
    const [createFromMutation] = useMutation<
        CmsEntryCreateFromMutationResponse,
        CmsEntryCreateFromMutationVariables
    >(CREATE_CONTENT_FROM);

    /**
     * Note that when passing `error.data` variable we cast as InvalidFieldError[] because we know it is so.
     */
    const setInvalidFieldValues = (errors?: InvalidFieldError[]): void => {
        if (Array.isArray(errors) === false || !errors) {
            return;
        }
        const values = (errors || []).reduce((acc, er) => {
            acc[er.fieldId] = er.error;
            return acc;
        }, {} as Record<string, string>);
        setInvalidFields(() => values);
    };

    const resetInvalidFieldValues = (): void => {
        setInvalidFields(() => ({}));
    };

    const createContent: FormOnSubmit = useCallback(
        async (formData, form) => {
            setLoading(true);
            const response = await createMutation({
                variables: { data: formData },
                fetchPolicy: getFetchPolicy(model)
            });

            setLoading(false);

            // Finalize "create" process
            if (!response.data) {
                showSnackbar("Missing response data in Create Entry.");
                return;
            }
            const { data: entry, error } = response.data.content || {};
            if (error) {
                showSnackbar(error.message);
                setInvalidFieldValues(error.data as InvalidFieldError[]);
                return;
            } else if (!entry) {
                showSnackbar("Missing entry data in Create Entry Response.");
                return;
            }
            resetInvalidFieldValues();
            if (params.addEntryToListCache) {
                GQLCache.addEntryToListCache(model, client.cache, entry, listQueryVariables);
            }

            showSnackbar(`${model.name} entry created successfully!`);
            if (typeof params.onSubmit === "function") {
                params.onSubmit(entry, form);
            } else {
                goToRevision(entry.id);
            }
            return entry;
        },
        [model.modelId, listQueryVariables, params.onSubmit, params.addEntryToListCache]
    );

    const updateContent = useCallback(
        async (revision, data) => {
            setLoading(true);
            const response = await updateMutation({
                variables: { revision, data },
                fetchPolicy: getFetchPolicy(model)
            });
            setLoading(false);
            if (!response.data) {
                showSnackbar("Missing response data on Update Entry Response.");
                return;
            }

            const { error } = response.data.content;
            if (error) {
                showSnackbar(error.message);
                setInvalidFieldValues(error.data as InvalidFieldError[]);
                return null;
            }

            resetInvalidFieldValues();
            showSnackbar("Content saved successfully.");
            const { data: entry } = response.data.content;
            return entry;
        },
        [model.modelId]
    );

    const createContentFrom = useCallback(
        async (revision: string, formData: Record<string, any>) => {
            setLoading(true);
            const response = await createFromMutation({
                variables: { revision, data: formData },
                fetchPolicy: getFetchPolicy(model)
            });

            if (!response.data) {
                showSnackbar("Missing data in update callback on Create From Entry Response.");
                return;
            }
            const { data: newRevision, error } = response.data.content;
            if (error) {
                showSnackbar(error.message);
                setInvalidFieldValues(error.data as InvalidFieldError[]);
                return;
            } else if (!newRevision) {
                showSnackbar("Missing entry data in update callback on Create From Entry.");
                return;
            }
            resetInvalidFieldValues();
            GQLCache.updateLatestRevisionInListCache(
                model,
                client.cache,
                newRevision,
                listQueryVariables
            );
            GQLCache.addRevisionToRevisionsCache(model, client.cache, newRevision);

            showSnackbar("A new revision was created!");
            goToRevision(newRevision.id);

            setLoading(false);

            return newRevision;
        },
        [model.modelId, listQueryVariables]
    );

    const onChange: FormOnSubmit = (data, form) => {
        if (!params.onChange) {
            return;
        }
        return params.onChange(data, form);
    };

    const onSubmit: FormOnSubmit = async (data, form) => {
        const fieldsIds = model.fields.map(item => item.fieldId);
        const formData = pick(data, [...fieldsIds]);

        const gqlData = prepareFormData(formData, model.fields);
        if (!entry.id) {
            return createContent(gqlData, form);
        }

        const { meta } = entry;
        const { locked: isLocked } = meta || {};

        if (!isLocked) {
            return updateContent(entry.id, gqlData);
        }

        return createContentFrom(entry.id, gqlData);
    };

    const defaultValues = useMemo((): Record<string, any> => {
        const values: Record<string, any> = {};
        /**
         * Assign the default values:
         * * check the settings.defaultValue
         * * check the predefinedValues for selected value
         */
        for (const field of model.fields) {
            /**
             * When checking if defaultValue is set in settings, we do the undefined check because it can be null, 0, empty string, false, etc...
             */
            const { settings, multipleValues = false } = field;
            if (settings && settings.defaultValue !== undefined) {
                /**
                 * Special type of field is the boolean one.
                 * We MUST set true/false for default value.
                 */
                values[field.fieldId] = convertDefaultValue(field, settings.defaultValue);
                continue;
            }
            /**
             * No point in going further if predefined values are not enabled.
             */
            const { predefinedValues } = field;
            if (
                !predefinedValues ||
                !predefinedValues.enabled ||
                Array.isArray(predefinedValues.values) === false
            ) {
                continue;
            }
            /**
             * When field is not a multiple values one, we find the first possible default selected value and set it as field value.
             */
            if (!multipleValues) {
                const selectedValue = predefinedValues.values.find(({ selected }) => {
                    return !!selected;
                });
                if (selectedValue) {
                    values[field.fieldId] = convertDefaultValue(field, selectedValue.value);
                }
                continue;
            }
            /**
             *
             */
            values[field.fieldId] = predefinedValues.values
                .filter(({ selected }) => !!selected)
                .map(({ value }) => {
                    return convertDefaultValue(field, value);
                });
        }
        return values;
    }, [model.modelId]);

    return {
        /**
         * If entry is not set or `entry.id` does not exist, it means it's a new entry, so fetch default values.
         */
        data: entry && entry.id ? entry : defaultValues,
        loading,
        setLoading,
        onChange,
        onSubmit,
        invalidFields,
        renderPlugins
    };
}
