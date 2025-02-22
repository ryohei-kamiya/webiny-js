import { PbImportExportContext } from "~/types";
import { SecurityIdentity } from "@webiny/api-security/types";
import { createRawEventHandler } from "@webiny/handler-aws";
import { blocksHandler } from "~/export/process/blocksHandler";
import { pagesHandler } from "~/export/process/pagesHandler";

export interface Configuration {
    handlers: {
        process: string;
        combine: string;
    };
}

export interface Payload {
    taskId: string;
    subTaskIndex: number;
    type: string;
    identity?: SecurityIdentity;
}

export interface Response {
    data: string | null;
    error: Partial<Error> | null;
}

export default (configuration: Configuration) => {
    return createRawEventHandler<Payload, PbImportExportContext, Response>(
        async ({ payload, context }) => {
            if (payload.type === "block") {
                return await blocksHandler(configuration, payload, context);
            } else {
                return await pagesHandler(configuration, payload, context);
            }
        }
    );
};
