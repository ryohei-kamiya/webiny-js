import * as React from "react";
import ReCAPTCHA from "react-google-recaptcha";
import { reCaptchaEnabled } from "./../functions";
import { CreateFormParams, FormData } from "../../types";

type CreateReCaptchaComponentArgs = {
    createFormParams: CreateFormParams;
    formData: FormData;
    setResponseToken: (value: string) => void;
};

interface ChildrenFunction {
    ({ errorMessage }: { errorMessage: string }): React.ReactNode;
}

export type ReCaptchaProps = {
    children?: React.ReactNode | ChildrenFunction;
    onChange?: (value: string) => void;
    onErrored?: Function;
    onExpired?: Function;
};

export type ReCaptchaComponent = React.FC<ReCaptchaProps>;

const createReCaptchaComponent = ({
    formData,
    setResponseToken
}: CreateReCaptchaComponentArgs): ReCaptchaComponent =>
    function ReCaptcha(props: ReCaptchaProps) {
        if (!reCaptchaEnabled(formData)) {
            return null;
        }

        const { settings } = formData;
        if (typeof props.children === "function") {
            return props.children({
                errorMessage: settings.reCaptcha.errorMessage
            });
        }

        if (props.children) {
            return props.children;
        }

        return (
            <ReCAPTCHA
                {...props}
                sitekey={settings.reCaptcha.settings.siteKey}
                onChange={response => {
                    setResponseToken(response as unknown as string);
                    typeof props.onChange === "function" &&
                        props.onChange(response as unknown as string);
                }}
                onErrored={(...args) => {
                    setResponseToken("");
                    typeof props.onErrored === "function" && props.onErrored(...args);
                }}
                onExpired={(...args) => {
                    setResponseToken("");
                    typeof props.onExpired === "function" && props.onExpired(...args);
                }}
            />
        );
    };

export default createReCaptchaComponent;
