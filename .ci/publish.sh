#!/bin/sh
set -eu

require_tty() {
	if ! ( : < /dev/tty ) 2>/dev/null; then
		printf 'publish requires an interactive terminal\n' >&2
		exit 1
	fi
	exec < /dev/tty
}

is_digits() {
	case "$1" in
		''|*[!0-9]*) return 1 ;;
		*) return 0 ;;
	esac
}

latest_version_tag() {
	for tag in $(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname); do
		version=${tag#v}
		old_ifs=$IFS; IFS=.; set -- $version; IFS=$old_ifs
		if [ "$#" -eq 3 ] && is_digits "$1" && is_digits "$2" && is_digits "$3"; then
			printf '%s' "$tag"
			return 0
		fi
	done
	printf 'v0.0.0'
}

print_option() {
	marker=' '
	if [ "$selected" -eq "$1" ]; then marker='>'; fi
	printf '%s %s) %-5s %s\n' "$marker" "$1" "$2" "$3"
}

render_menu() {
	printf '\033[2J\033[H'
	printf 'Latest tag: %s\n\n' "$latest_tag"
	printf 'Select version bump:\n'
	print_option 1 major "$major_tag"
	print_option 2 minor "$minor_tag"
	print_option 3 patch "$patch_tag"
	printf '\nUse 1/2/3, Up/Down, Enter to confirm, Esc to cancel.\n'
}

read_key() {
	stty -echo -icanon min 1 time 0
	key=$(dd bs=1 count=1 2>/dev/null || true)
	if [ "$key" = "$(printf '\033')" ]; then
		stty -echo -icanon min 0 time 1
		key="$key$(dd bs=1 count=2 2>/dev/null || true)"
	fi
	stty "$old_stty"
	printf '%s' "$key"
}

select_tag() {
	esc=$(printf '\033'); up=$(printf '\033[A'); down=$(printf '\033[B')
	while true; do
		render_menu
		key=$(read_key)
		case "$key" in
			1) selected=1; break ;;
			2) selected=2; break ;;
			3) selected=3; break ;;
			"") break ;;
			"$esc") printf '\nCancelled\n'; exit 0 ;;
			"$up") selected=$((selected - 1)); [ "$selected" -lt 1 ] && selected=3 ;;
			"$down") selected=$((selected + 1)); [ "$selected" -gt 3 ] && selected=1 ;;
		esac
	done
	case "$selected" in
		1) new_tag=$major_tag ;;
		2) new_tag=$minor_tag ;;
		3) new_tag=$patch_tag ;;
	esac
}

require_tty
git fetch --tags --quiet

latest_tag=$(latest_version_tag)
version=${latest_tag#v}
old_ifs=$IFS; IFS=.; set -- $version; IFS=$old_ifs
major=$1; minor=$2; patch=$3

major_tag=v$((major + 1)).0.0
minor_tag=v$major.$((minor + 1)).0
patch_tag=v$major.$minor.$((patch + 1))
selected=3
old_stty=$(stty -g)
trap 'stty "$old_stty"' EXIT INT TERM

new_tag=''
select_tag
printf '\nCreate and push %s? [y/N] ' "$new_tag"
read confirm

case "$confirm" in
	y|Y|yes|YES) ;;
	*) printf 'Cancelled\n'; exit 0 ;;
esac

if git rev-parse --verify --quiet "refs/tags/$new_tag" >/dev/null; then
	printf 'Tag %s already exists\n' "$new_tag" >&2
	exit 1
fi

git tag "$new_tag"
git push origin "$new_tag"
printf 'Published %s\n' "$new_tag"
