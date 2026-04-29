"""CLI entry point for artgen — art generation management tool."""

import argparse

from . import commands


def build_parser():
    parser = argparse.ArgumentParser(
        prog="artgen",
        description="Art generation management tool",
    )
    sub = parser.add_subparsers(dest="command")

    # --- session ---
    sess = sub.add_parser("session")
    sess_sub = sess.add_subparsers(dest="session_cmd")

    s_new = sess_sub.add_parser("new")
    s_new.add_argument("name")
    s_new.add_argument("--desc")
    s_new.add_argument("--project")

    s_list = sess_sub.add_parser("list")
    s_list.add_argument("--project")

    s_show = sess_sub.add_parser("show")
    s_show.add_argument("session_id")
    s_show.add_argument("--project")

    # --- gen ---
    gen = sub.add_parser("gen")
    gen.add_argument("--prompt", required=True)
    gen.add_argument("--seed", type=int, nargs="*")
    gen.add_argument("--model")
    gen.add_argument("--aspect-ratio", dest="aspect_ratio")
    gen.add_argument("--session")
    gen.add_argument("--asset-type", dest="asset_type")
    gen.add_argument("--asset-name", dest="asset_name")
    gen.add_argument("--tribe")
    gen.add_argument("--experiment")
    gen.add_argument("--project")

    # --- batch ---
    bat = sub.add_parser("batch")
    bat.add_argument("batch_file")
    bat.add_argument("--session")
    bat.add_argument("--project")

    # --- serve ---
    srv = sub.add_parser("serve")
    srv.add_argument("--project")
    srv.add_argument("--port", type=int)

    # --- sync ---
    syn = sub.add_parser("sync")
    syn.add_argument("--project")

    # --- review ---
    rev = sub.add_parser("review")
    rev_sub = rev.add_subparsers(dest="review_cmd")
    r_sess = rev_sub.add_parser("session")
    r_sess.add_argument("session_id")
    r_sess.add_argument("--project")
    r_sess.add_argument("--port", type=int)

    # --- list ---
    lst = sub.add_parser("list")
    lst.add_argument("--session")
    lst.add_argument("--rating")
    lst.add_argument("--asset-type", dest="asset_type")
    lst.add_argument("--experiment")
    lst.add_argument("--project")

    # --- show ---
    shw = sub.add_parser("show")
    shw.add_argument("image_id")
    shw.add_argument("--project")

    # --- rate ---
    rat = sub.add_parser("rate")
    rat.add_argument("image_id")
    rat.add_argument("rating",
                     choices=["approved", "maybe", "reject", "reference"])
    rat.add_argument("--note")
    rat.add_argument("--project")

    # --- delete ---
    dl = sub.add_parser("delete")
    dl.add_argument("image_id", nargs="?")
    dl.add_argument("--rating")
    dl.add_argument("--session")
    dl.add_argument("--project")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    dispatch = {
        "gen": commands.cmd_gen,
        "batch": commands.cmd_batch,
        "serve": commands.cmd_serve,
        "sync": commands.cmd_sync,
        "list": commands.cmd_list,
        "show": commands.cmd_show,
        "rate": commands.cmd_rate,
        "delete": commands.cmd_delete,
    }

    if args.command == "session":
        if args.session_cmd == "new":
            commands.cmd_session_new(args)
        elif args.session_cmd == "list":
            commands.cmd_session_list(args)
        elif args.session_cmd == "show":
            commands.cmd_session_show(args)
        else:
            parser.parse_args(["session", "--help"])
    elif args.command == "review":
        if args.review_cmd == "session":
            commands.cmd_review_session(args)
        else:
            parser.parse_args(["review", "--help"])
    elif args.command in dispatch:
        dispatch[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
