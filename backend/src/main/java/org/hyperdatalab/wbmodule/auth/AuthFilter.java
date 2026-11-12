package org.hyperdatalab.wbmodule.auth;

import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.ErrorHandler;
import org.hyperdatalab.wbmodule.directory.UserDirectory;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Every /api route except /api/health needs a signed-in user of the org domain who is active in the
 * user directory and not disabled here.
 */
@Component
public class AuthFilter extends OncePerRequestFilter {
    private final TokenVerifier verifier;
    private final IdentityService identity;
    private final ObjectMapper json;

    public AuthFilter(TokenVerifier verifier, IdentityService identity, ObjectMapper json) {
        this.verifier = verifier;
        this.identity = identity;
        this.json = json;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest req) {
        String path = req.getRequestURI();
        return !path.startsWith("/api/")
                || path.equals("/api/health")
                // Dev-only helpers; the controller exists only with app.auth.mode=dev.
                || path.startsWith("/api/dev/")
                || "OPTIONS".equals(req.getMethod());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        try {
            String header = req.getHeader("Authorization");
            String token =
                    header != null && header.startsWith("Bearer ")
                            ? header.substring(7).trim()
                            : "";
            if (token.isEmpty())
                throw TokenVerifiers.unauthorized("unauthenticated", "Sign in first.");
            AuthedUser user = identity.resolve(verifier.verify(token));
            req.setAttribute(AuthedUser.ATTRIBUTE, user);
        } catch (ApiException e) {
            write(res, e.status().value(), e.code(), e.getMessage());
            return;
        } catch (UserDirectory.DirectoryException e) {
            write(res, 502, "directory_error", e.getMessage());
            return;
        }
        chain.doFilter(req, res);
    }

    private void write(HttpServletResponse res, int status, String code, String message)
            throws IOException {
        res.setStatus(status);
        if (status == 401) {
            // RFC 6750: tell the client which scheme to use and why the token was refused.
            res.setHeader(
                    "WWW-Authenticate", "Bearer realm=\"writing-bank\", error=\"invalid_token\"");
        }
        res.setHeader("Cache-Control", "no-store");
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        res.setCharacterEncoding("UTF-8");
        json.writeValue(res.getOutputStream(), ErrorHandler.body(code, message));
    }
}
