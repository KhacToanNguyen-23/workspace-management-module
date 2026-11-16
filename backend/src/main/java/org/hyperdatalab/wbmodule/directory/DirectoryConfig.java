package org.hyperdatalab.wbmodule.directory;

import com.fasterxml.jackson.databind.ObjectMapper;

import org.hyperdatalab.wbmodule.common.AppProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

@Configuration
public class DirectoryConfig {

    @Bean
    UserDirectory userDirectory(AppProperties props, ObjectMapper json) {
        AppProperties.Directory d = props.directory();
        // With the SSO, profiles come from the sign-in itself; a directory would overwrite them.
        String mode = "sso".equals(props.auth().mode()) ? "off" : d.mode();
        return switch (mode) {
            case "http" ->
                    new HttpUserDirectory(json, d.httpBaseUrl(), d.httpToken(), props.orgDomain());
            case "google" ->
                    new GoogleUserDirectory(
                            json,
                            d.googleServiceAccountFile(),
                            props.adminEmail(),
                            props.orgDomain());
            case "mock" -> new MockUserDirectory(d.mockUsers(), props.orgDomain());
            case "off" ->
                    new MockUserDirectory(List.of(), props.orgDomain()) {
                        @Override
                        public String mode() {
                            return "off";
                        }
                    };
            default ->
                    throw new IllegalStateException(
                            "app.directory.mode must be http, google, mock or off");
        };
    }

    /**
     * Local development and tests. With no users configured, every domain address counts as active.
     */
    public static class MockUserDirectory implements UserDirectory {
        private final List<DirectoryUser> users;
        private final String domain;

        public MockUserDirectory(List<AppProperties.MockUser> users, String domain) {
            this.users =
                    users.stream()
                            .map(
                                    u ->
                                            new DirectoryUser(
                                                    u.email().toLowerCase(Locale.ROOT),
                                                    u.name() == null ? "" : u.name(),
                                                    null,
                                                    u.department(),
                                                    u.suspended()))
                            .toList();
            this.domain = domain;
        }

        @Override
        public String mode() {
            return "mock";
        }

        @Override
        public Optional<DirectoryUser> find(String email) {
            String e = email.toLowerCase(Locale.ROOT);
            if (users.isEmpty()) {
                return e.endsWith("@" + domain)
                        ? Optional.of(new DirectoryUser(e, "", null, null, false))
                        : Optional.empty();
            }
            return users.stream().filter(u -> u.email().equals(e)).findFirst();
        }

        @Override
        public List<DirectoryUser> listAll() {
            return users;
        }
    }
}
