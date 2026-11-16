package org.hyperdatalab.wbmodule.common;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.util.List;

/** Settings under `app.*` in application.yml. */
@ConfigurationProperties(prefix = "app")
public record AppProperties(
        @DefaultValue("hyperdatalab.org") String orgDomain,
        @DefaultValue("admin@hyperdatalab.org") String adminEmail,
        @DefaultValue Auth auth,
        @DefaultValue Directory directory,
        @DefaultValue Projects projects,
        @DefaultValue("http://localhost:3000") List<String> corsOrigins) {

    /**
     * mode=sso signs users in through the HyperDataLab SSO (production); mode=firebase verifies
     * Firebase ID tokens; mode=dev accepts `Bearer dev:<email>` and must only be used locally.
     * allowedProviders: identity providers accepted in firebase mode (`sign_in_provider` values).
     */
    public record Auth(
            @DefaultValue("firebase") String mode,
            @DefaultValue("hyperdatalab-writing-bank") String firebaseProjectId,
            @DefaultValue("google.com") List<String> allowedProviders,
            @DefaultValue Sso sso) {}

    /**
     * The HyperDataLab SSO (OAuth 2.0 Authorization Code + PKCE on the ResearchPulse Worker).
     * clientSecret is empty for a Public client. sessionHours: how long a sign-in lasts here
     * before the user goes through the SSO again.
     */
    public record Sso(
            String baseUrl,
            String clientId,
            String clientSecret,
            @DefaultValue("12") int sessionHours,
            String tokenKey) {}

    /**
     * Research projects, owned by ResearchPulse. mode=http reads them from the ResearchPulse API
     * with the signed-in user's own SSO token; mode=demo keeps sample projects in memory;
     * mode=off hides them; mode=auto (default) is http with the SSO and demo otherwise. Empty
     * baseUrl = the SSO base URL.
     */
    public record Projects(@DefaultValue("auto") String mode, String baseUrl) {}

    /**
     * Where user information for the org domain comes from. mode=http : an external REST API (GET
     * {baseUrl}/users/{email}, GET {baseUrl}/users) mode=google : Google Admin SDK Directory API
     * via a service account with domain-wide delegation mode=mock : the users listed in mockUsers
     * (empty = every domain address is active) mode=off : no directory check
     */
    public record Directory(
            @DefaultValue("mock") String mode,
            String httpBaseUrl,
            String httpToken,
            String googleServiceAccountFile,
            @DefaultValue("12") int cacheHours,
            @DefaultValue List<MockUser> mockUsers) {}

    public record MockUser(String email, String name, String department, boolean suspended) {}
}
