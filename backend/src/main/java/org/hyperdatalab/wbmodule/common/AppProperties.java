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
        @DefaultValue("http://localhost:5174") List<String> corsOrigins) {

    /**
     * mode=firebase verifies Firebase ID tokens (production); mode=dev accepts `Bearer dev:<email>`
     * and must only be used locally. allowedProviders: identity providers accepted as SSO (Firebase
     * `sign_in_provider` values).
     */
    public record Auth(
            @DefaultValue("firebase") String mode,
            @DefaultValue("hyperdatalab-writing-bank") String firebaseProjectId,
            @DefaultValue("google.com") List<String> allowedProviders) {}

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
