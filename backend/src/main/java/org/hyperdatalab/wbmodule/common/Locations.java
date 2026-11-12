package org.hyperdatalab.wbmodule.common;

import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;

/** Builds the {@code Location} header value for a newly created resource. */
public final class Locations {
    public static final String API = "/api/v1";

    private Locations() {}

    /** {@code Locations.of("/workspaces/{id}", id)} gives {@code <context>/api/v1/workspaces/<id>}. */
    public static URI of(String template, Object... variables) {
        return ServletUriComponentsBuilder.fromCurrentContextPath()
                .path(API + template)
                .buildAndExpand(variables)
                .encode()
                .toUri();
    }
}
