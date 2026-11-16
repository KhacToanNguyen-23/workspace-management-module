package org.hyperdatalab.wbmodule.projects;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.Locations;
import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** Research projects (from ResearchPulse) and, where supported, admin changes to members. */
@RestController
@RequestMapping(Locations.API + "/projects")
public class ProjectController {
    private static final String ID = "[A-Za-z0-9_.:-]{1,128}";

    private final ProjectService projects;

    public ProjectController(ProjectService projects) {
        this.projects = projects;
    }

    private static String id(String value) {
        if (!value.matches(ID)) throw ApiException.notFound("Not found.");
        return value;
    }

    /** This module's session token, which leads to the user's SSO token kept with it. */
    private static String session(HttpServletRequest req) {
        String h = req.getHeader("Authorization");
        return h != null && h.startsWith("Bearer ") ? h.substring(7).trim() : null;
    }

    private static <T> ResponseEntity<T> privately(T body) {
        // Project data is private to the user (ResearchPulse asks for no shared caching).
        return ResponseEntity.ok().cacheControl(CacheControl.noStore().cachePrivate()).body(body);
    }

    /** The projects the page may show; {@code mode} = demo for sample data. */
    @GetMapping
    ResponseEntity<Map<String, Object>> list(AuthedUser u, HttpServletRequest req) {
        return privately(projects.list(u, session(req)));
    }

    @GetMapping("/{pid}")
    ResponseEntity<Map<String, Object>> detail(
            AuthedUser u, @PathVariable String pid, HttpServletRequest req) {
        return privately(projects.detail(u, session(req), id(pid)));
    }

    record AddMember(
            @NotBlank @Email String email, @NotBlank @Pattern(regexp = "OWNER|MEMBER") String role) {}

    record RoleChange(@NotBlank @Pattern(regexp = "OWNER|MEMBER") String role) {}

    /** Admins: adds someone to the project. */
    @PostMapping("/{pid}/members")
    ResponseEntity<Map<String, Object>> add(
            AuthedUser u, @PathVariable String pid, @Valid @RequestBody AddMember b) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(projects.addMember(u, id(pid), b.email(), b.role()));
    }

    /** Admins: changes a member's role. */
    @PatchMapping("/{pid}/members/{uid}")
    Map<String, Object> update(
            AuthedUser u,
            @PathVariable String pid,
            @PathVariable String uid,
            @Valid @RequestBody RoleChange b) {
        return projects.updateMember(u, id(pid), id(uid), b.role());
    }

    /** Admins: removes someone from the project. */
    @DeleteMapping("/{pid}/members/{uid}")
    ResponseEntity<Void> remove(AuthedUser u, @PathVariable String pid, @PathVariable String uid) {
        projects.removeMember(u, id(pid), id(uid));
        return ResponseEntity.noContent().build();
    }

}
