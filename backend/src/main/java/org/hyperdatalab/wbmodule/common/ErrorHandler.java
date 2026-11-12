package org.hyperdatalab.wbmodule.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;
import java.util.stream.Collectors;

@RestControllerAdvice
public class ErrorHandler {
    private static final Logger log = LoggerFactory.getLogger(ErrorHandler.class);

    public static Map<String, Object> body(String code, String message) {
        return Map.of("error", Map.of("code", code, "message", message));
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Object> api(ApiException e) {
        return ResponseEntity.status(e.status()).body(body(e.code(), e.getMessage()));
    }

    @ExceptionHandler(org.hyperdatalab.wbmodule.directory.UserDirectory.DirectoryException.class)
    ResponseEntity<Object> directory(RuntimeException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(body("directory_error", e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Object> invalid(MethodArgumentNotValidException e) {
        String msg =
                e.getBindingResult().getFieldErrors().stream()
                        .map(f -> f.getField() + ": " + f.getDefaultMessage())
                        .collect(Collectors.joining("; "));
        return ResponseEntity.unprocessableEntity()
                .body(body("validation", msg.isEmpty() ? "Invalid body." : msg));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Object> unreadable(HttpMessageNotReadableException e) {
        return ResponseEntity.badRequest().body(body("bad_json", "Body must be valid JSON."));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<Object> badParam(MethodArgumentTypeMismatchException e) {
        return ResponseEntity.badRequest()
                .body(body("bad_parameter", "Invalid value for \"" + e.getName() + "\"."));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Object> noRoute(NoResourceFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(body("not_found", "No such route."));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Object> other(Exception e) {
        log.error("Unhandled error", e);
        return ResponseEntity.internalServerError()
                .body(body("internal", "Unexpected server error."));
    }
}
